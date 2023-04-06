import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as io from '@actions/io';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as stateHelper from './state-helper';
import { envRegex, pathRegex } from './matchers'

function getEmArgs() {
  return {
    version: core.getInput("version"),
    noInstall: core.getInput("no-install"),
    noCache: core.getInput("no-cache"),
    cacheKey: core.getInput("cache-key"),
    cacheFolder: core.getInput("cache-folder"),
    // XXX: update-tags is deprecated and used for backwards compatibility.
    update: core.getInput("update") || core.getInput("update-tags")
  };
}

async function run() {
  try {
    const emArgs = getEmArgs();
    stateHelper.setFoundInCache(false);
    const cacheFolder = path.normalize(emArgs.cacheFolder);
    let emsdkFolder;

    if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !cacheFolder) {
      emsdkFolder = tc.find('emsdk', emArgs.version, os.arch());
    }

    if (emArgs.cacheKey && cacheFolder) {
      try {
        try {
          fs.accessSync(path.join(cacheFolder, 'emsdk-main', 'emsdk'), fs.constants.X_OK);
        } catch {
          core.info(`Restoring cache from "${emArgs.cacheKey}" at path "${cacheFolder}"`);
          const restoredKey = await cache.restoreCache([cacheFolder], emArgs.cacheKey);
          core.info(`Cache was restored from "${restoredKey}" at path "${cacheFolder}"`);
        }
        fs.accessSync(path.join(cacheFolder, 'emsdk-main', 'emsdk'), fs.constants.X_OK);
        emsdkFolder = cacheFolder;
        stateHelper.setFoundInCache(true);
      } catch (e) {
        core.warning(`Got error: ${e}`);
        core.warning(`No cached files found at path "${cacheFolder}" - downloading and caching emsdk.`);
        await io.rmRF(cacheFolder);
        // core.debug(fs.readdirSync(cacheFolder + '/emsdk-main').toString());
      }
    }

    if (!emsdkFolder) {
      const emsdkArchive = await tc.downloadTool("https://github.com/emscripten-core/emsdk/archive/main.zip");
      emsdkFolder = await tc.extractZip(emsdkArchive, cacheFolder || undefined);
    } else {
      stateHelper.setFoundInCache(true);
    }

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

      if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !cacheFolder) {
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
    const emArgs = getEmArgs();
    const cacheFolder = path.normalize(emArgs.cacheFolder);

    if (emArgs.cacheKey && cacheFolder && !stateHelper.foundInCache()) {
      const zipsPath = path.join(cacheFolder, 'emsdk-main', 'zips');
      await io.rmRF(zipsPath);
      fs.mkdirSync(cacheFolder, { recursive: true });
      await cache.saveCache([cacheFolder], emArgs.cacheKey);
    }
  } catch (error) {
    core.warning(`${(error as any)?.message ?? error}`)
  }
}

// Main
if (!stateHelper.IsPost) {
  run()
}
// Post
else {
  cleanup()
}
