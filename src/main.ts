import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as io from '@actions/io';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { envRegex, pathRegex } from './matchers'

async function run() {
  try {
    const emArgs = {
      version: await core.getInput("version"),
      noInstall: await core.getInput("no-install"),
      noCache: await core.getInput("no-cache"),
      actionsCacheFolder: await core.getInput("actions-cache-folder"),
      // XXX: update-tags is deprecated and used for backwards compatibility.
      update: await core.getInput("update") || await core.getInput("update-tags")
    };

    let emsdkFolder;
    let foundInCache = false;

    if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !emArgs.actionsCacheFolder) {
      emsdkFolder = await tc.find('emsdk', emArgs.version, os.arch());
    }

    const cacheKey = `${emArgs.version}-${os.platform()}-${os.arch()}-master`;
    if (emArgs.actionsCacheFolder && process.env.GITHUB_WORKSPACE) {
      const fullCachePath = path.join(process.env.GITHUB_WORKSPACE, emArgs.actionsCacheFolder);
      try {
        try {
          fs.accessSync(path.join(fullCachePath, 'emsdk', 'emsdk'), fs.constants.X_OK);
        } catch {
          await cache.restoreCache([emArgs.actionsCacheFolder], cacheKey);
        }
        fs.accessSync(path.join(fullCachePath, 'emsdk', 'emsdk'), fs.constants.X_OK);
        emsdkFolder = fullCachePath;
        foundInCache = true;
      } catch {
        core.warning(`No cached files found at path "${fullCachePath}" - downloading and caching emsdk.`);
        await io.rmRF(fullCachePath);
        // core.debug(fs.readdirSync(fullCachePath + '/emsdk').toString());
      }
    }

    if (!emsdkFolder) {
      let emsdkInstallerUrl;
      if (emArgs.version !== "latest" && emArgs.version !== "tot") {
        emsdkInstallerUrl = `https://github.com/emscripten-core/emsdk/archive/refs/tags/${emArgs.version}.zip`
      } else {
        emsdkInstallerUrl = "https://github.com/emscripten-core/emsdk/archive/main.zip";
      }
      const emsdkArchive = await tc.downloadTool(emsdkInstallerUrl);
      emsdkFolder = await tc.extractZip(emsdkArchive);
      let srcDir;
      if (emArgs.version !== "latest" && emArgs.version !== "tot") {
        srcDir = path.join(emsdkFolder, `emsdk-${emArgs.version}`);
      } else {
        srcDir = path.join(emsdkFolder, 'emsdk-main');
      }
      fs.rename(srcDir, path.join(emsdkFolder, 'emsdk'), (err) => {
        if (err) throw err;
      });
    } else {
      foundInCache = true;
    }

    let emsdk = path.join(emsdkFolder, 'emsdk', 'emsdk');

    if (os.platform() === "win32") {
      emsdk = `powershell ${path.join(emsdkFolder, 'emsdk', 'emsdk.ps1')}`;
    }

    if (emArgs.noInstall === "true") {
      core.addPath(path.join(emsdkFolder, 'emsdk'));
      core.exportVariable("EMSDK", path.join(emsdkFolder, 'emsdk'));
      return;
    }

    if (!foundInCache) {
      if (emArgs.update) {
        await exec.exec(`${emsdk} update`);
      }

      await exec.exec(`${emsdk} install ${emArgs.version}`);

      if (emArgs.version !== "latest" && emArgs.version !== "tot" && emArgs.noCache === "false" && !emArgs.actionsCacheFolder) {
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

    if (emArgs.actionsCacheFolder && !foundInCache && process.env.GITHUB_WORKSPACE) {
      fs.mkdirSync(path.join(process.env.GITHUB_WORKSPACE, emArgs.actionsCacheFolder), { recursive: true });
      await io.cp(path.join(emsdkFolder, 'emsdk'), path.join(process.env.GITHUB_WORKSPACE, emArgs.actionsCacheFolder), { recursive: true })
      await cache.saveCache([emArgs.actionsCacheFolder], cacheKey);
    }
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

run();
