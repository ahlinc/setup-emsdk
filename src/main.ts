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

function flatten(lists) {
  return lists.reduce((a, b) => a.concat(b), []);
}

function getDirectories(srcpath) {
  return fs.readdirSync(srcpath)
    .map(file => path.join(srcpath, file))
    .filter(path => fs.statSync(path).isDirectory());
}

function getDirectoriesRecursive(srcpath) {
  return [srcpath, ...flatten(getDirectories(srcpath).map(getDirectoriesRecursive))];
}


function getEmArgs() {
  return {
    version: core.getInput("version"),
    noInstall: core.getInput("no-install"),
    noCache: core.getInput("no-cache"),
    cacheKey: core.getInput("cache-key"),
    installFolder: core.getInput("install-folder"),
    // XXX: update-tags is deprecated and used for backwards compatibility.
    update: core.getInput("update") || core.getInput("update-tags")
  };
}

async function run() {
  try {
    const emArgs = getEmArgs();
    stateHelper.setFoundInCache(false);
    const installFolder = path.normalize(emArgs.installFolder);
    let emsdkFolder;

    if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !installFolder) {
      emsdkFolder = tc.find('emsdk', emArgs.version, os.arch());
    }

    if (emArgs.cacheKey && installFolder) {
      try {
        try {
          fs.accessSync(path.join(installFolder, 'emsdk-main', 'emsdk'), fs.constants.X_OK);
        } catch {
          core.info(`Attempting to restore cache from "${emArgs.cacheKey}" at path "${installFolder}"`);
          const restoredKey = await cache.restoreCache([installFolder], emArgs.cacheKey);
          if (restoredKey) {
            core.info(`Cache was restored from "${restoredKey}" at path "${installFolder}"`);
          } else {
            core.info(`Cache wasn't restored from "${restoredKey}" cache key`);
          }
        }
        fs.accessSync(path.join(installFolder, 'emsdk-main', 'emsdk'), fs.constants.X_OK);
        emsdkFolder = installFolder;
        stateHelper.setFoundInCache(true);
      } catch (e) {
        core.warning(`ERR: ${e}`);
        try {
          console.log(getDirectoriesRecursive(installFolder));
        } catch (e) {
          core.warning(`ERR: ${e}`);
        }
        core.warning(`No cached files found at path "${installFolder}" - downloading and caching emsdk.`);
        await io.rmRF(installFolder);
        // core.debug(fs.readdirSync(cacheFolder + '/emsdk-main').toString());
      }
    }

    if (!emsdkFolder) {
      const emsdkArchive = await tc.downloadTool("https://github.com/emscripten-core/emsdk/archive/main.zip");
      emsdkFolder = await tc.extractZip(emsdkArchive, installFolder || undefined);
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

      if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !installFolder) {
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
    const installFolder = path.normalize(emArgs.installFolder);

    if (emArgs.cacheKey && installFolder && !stateHelper.foundInCache()) {
      const zipsPath = path.join(installFolder, 'emsdk-main', 'zips');
      await io.rmRF(zipsPath);
      fs.mkdirSync(installFolder, { recursive: true });
      const existingCacheKey = await cache.restoreCache([installFolder], emArgs.cacheKey, undefined, { lookupOnly: true });
      if (existingCacheKey) {
        core.info(`Skipping cache key that already exists "${existingCacheKey}"`);
        return;
      }
      await cache.saveCache([installFolder], emArgs.cacheKey);
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
