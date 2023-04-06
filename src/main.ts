import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as io from '@actions/io';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as stateHelper from './state-helper'
import { envRegex, pathRegex } from './matchers'

async function getArgs() {
  return {
    version: await core.getInput("version"),
    noInstall: await core.getInput("no-install"),
    noCache: await core.getInput("no-cache"),
    cacheKey: await core.getInput("cache-key"),
    cacheFolder: await core.getInput("cache-folder"),
    // XXX: update-tags is deprecated and used for backwards compatibility.
    update: await core.getInput("update") || await core.getInput("update-tags")
  };
}

async function run() {
  try {
    let emArgs = await getArgs();
    stateHelper.setFoundInCache(false);

    if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !emArgs.cacheFolder) {
      stateHelper.setEmsdkFolder(await tc.find('emsdk', emArgs.version, os.arch()));
    }

    if (emArgs.cacheKey && emArgs.cacheFolder) {
      try {
        try {
          fs.accessSync(path.join(emArgs.cacheFolder, 'emsdk-main', 'emsdk'), fs.constants.X_OK);
        } catch {
          await cache.restoreCache([emArgs.cacheFolder], emArgs.cacheKey);
        }
        fs.accessSync(path.join(emArgs.cacheFolder, 'emsdk-main', 'emsdk'), fs.constants.X_OK);
        stateHelper.setEmsdkFolder(emArgs.cacheFolder);
        stateHelper.setFoundInCache(true);
      } catch {
        core.warning(`No cached files found at path "${emArgs.cacheFolder}" - downloading and caching emsdk.`);
        await io.rmRF(emArgs.cacheFolder);
        // core.debug(fs.readdirSync(emArgs.cacheFolder + '/emsdk-main').toString());
      }
    }

    if (!stateHelper.emsdkFolder()) {
      const emsdkArchive = await tc.downloadTool("https://github.com/emscripten-core/emsdk/archive/main.zip");
      stateHelper.setEmsdkFolder(await tc.extractZip(emsdkArchive, emArgs.cacheFolder || undefined));
    } else {
      stateHelper.setFoundInCache(true);
    }

    const emsdkFolder = stateHelper.emsdkFolder();
    let emsdk = path.join(emsdkFolder, 'emsdk-main', 'emsdk');

    if (os.platform() === "win32") {
      emsdk = `powershell ${path.join(emsdkFolder, 'emsdk-main', 'emsdk.ps1')}`;
    }

    if (emArgs.noInstall === "true") {
      core.addPath(path.join(emsdkFolder, 'emsdk-main'));
      core.exportVariable("EMSDK", path.join(emsdkFolder, 'emsdk-main'));
      return;
    }

    if (!stateHelper.foundInCache()) {
      if (emArgs.update) {
        await exec.exec(`${emsdk} update`);
      }

      await exec.exec(`${emsdk} install ${emArgs.version}`);

      if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !emArgs.cacheFolder) {
        await tc.cacheDir(emsdkFolder, 'emsdk', emArgs.version, os.arch());
      }
    }

    await exec.exec(`${emsdk} activate ${emArgs.version}`);
    const envListener = (message) => {
      const pathResult = pathRegex.exec(message);

      if (pathResult) {
        core.addPath(pathResult[1]);
        return;
      }

      const envResult = envRegex.exec(message);

      if (envResult) {
        core.exportVariable(envResult[1], envResult[2]);
        return;
      }
    };
    await exec.exec(`${emsdk} construct_env`, [], { listeners: { stdline: envListener, errline: envListener } })
  } catch (error) {
    if (error &&
      typeof error === "object" &&
      "message" in error &&
      (
        typeof error.message === "string" ||
        error.message instanceof Error
      )) {
      core.setFailed(error.message);
    }
  }
}

async function cleanup(): Promise<void> {
  try {
    let emArgs = await getArgs();
    if (emArgs.cacheKey && emArgs.cacheFolder && !stateHelper.foundInCache()) {
      fs.mkdirSync(emArgs.cacheFolder, { recursive: true });
      await cache.saveCache([emArgs.cacheFolder], emArgs.cacheKey);
    }
  } catch (error) {
    core.warning(`${(error as any)?.message ?? error}`)
  }
}

// Main
if (!core.getState('isPost')) {
  run()
}
// Post
else {
  cleanup()
}
