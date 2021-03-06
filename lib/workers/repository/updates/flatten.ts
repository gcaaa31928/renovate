import is from '@sindresorhus/is';
import {
  PackageRule,
  RenovateConfig,
  filterConfig,
  getManagerConfig,
  mergeChildConfig,
} from '../../../config';
import { LANGUAGE_DOCKER } from '../../../constants/languages';
import { getDefaultConfig } from '../../../datasource';
import { get } from '../../../manager';
import { applyPackageRules } from '../../../util/package-rules';
import { generateBranchName } from './branch-name';

// Return only rules that contain an updateType
function getUpdateTypeRules(packageRules: PackageRule[]): PackageRule[] {
  return packageRules.filter((rule) => is.nonEmptyArray(rule.updateTypes));
}

const upper = (str: string): string =>
  str.charAt(0).toUpperCase() + str.substr(1);

export async function flattenUpdates(
  config: RenovateConfig,
  packageFiles: Record<string, any[]>
): Promise<RenovateConfig[]> {
  const updates = [];
  const updateTypes = [
    'major',
    'minor',
    'patch',
    'pin',
    'digest',
    'lockFileMaintenance',
  ];
  for (const [manager, files] of Object.entries(packageFiles)) {
    const managerConfig = getManagerConfig(config, manager);
    for (const packageFile of files) {
      const packageFileConfig = mergeChildConfig(managerConfig, packageFile);
      const packagePath = packageFile.packageFile?.split('/');
      if (packagePath.length > 0) {
        packagePath.splice(-1, 1);
      }
      if (packagePath.length > 0) {
        packageFileConfig.parentDir = packagePath[packagePath.length - 1];
        packageFileConfig.baseDir = packagePath.join('/');
      } else {
        packageFileConfig.parentDir = '';
        packageFileConfig.baseDir = '';
      }
      for (const dep of packageFile.deps) {
        if (dep.updates.length) {
          const depConfig = mergeChildConfig(packageFileConfig, dep);
          delete depConfig.deps;
          for (const update of dep.updates) {
            let updateConfig = mergeChildConfig(depConfig, update);
            delete updateConfig.updates;
            // Massage legacy vars just in case
            updateConfig.currentVersion = updateConfig.currentValue;
            updateConfig.newVersion =
              updateConfig.newVersion || updateConfig.newValue;
            if (updateConfig.updateType) {
              updateConfig[`is${upper(updateConfig.updateType)}`] = true;
            }
            if (updateConfig.updateTypes) {
              updateConfig.updateTypes.forEach((updateType) => {
                updateConfig[`is${upper(updateType)}`] = true;
              });
            }
            // apply config from datasource
            const datasourceConfig = await getDefaultConfig(
              depConfig.datasource
            );
            updateConfig = mergeChildConfig(updateConfig, datasourceConfig);
            updateConfig = applyPackageRules(updateConfig);
            // Keep only rules that haven't been applied yet (with updateTypes)
            updateConfig.packageRules = getUpdateTypeRules(
              updateConfig.packageRules
            );
            // apply major/minor/patch/pin/digest
            updateConfig = mergeChildConfig(
              updateConfig,
              updateConfig[updateConfig.updateType]
            );
            for (const updateType of updateTypes) {
              delete updateConfig[updateType];
            }
            // Apply again in case any were added by the updateType config
            updateConfig = applyPackageRules(updateConfig);
            delete updateConfig.packageRules;
            updateConfig.depNameSanitized = updateConfig.depName
              ? updateConfig.depName
                  .replace('@types/', '')
                  .replace('@', '')
                  .replace(/\//g, '-')
                  .replace(/\s+/g, '-')
                  .toLowerCase()
              : undefined;
            if (
              updateConfig.language === LANGUAGE_DOCKER &&
              updateConfig.depName.match(/(^|\/)node$/) &&
              updateConfig.depName !== 'calico/node'
            ) {
              updateConfig.additionalBranchPrefix = '';
              updateConfig.depNameSanitized = 'node';
            }
            generateBranchName(updateConfig);
            update.branchName = updateConfig.branchName; // for writing to cache
            delete updateConfig.repoIsOnboarded;
            delete updateConfig.renovateJsonPresent;
            updateConfig.baseDeps = packageFile.deps;
            updates.push(updateConfig);
          }
        }
      }
      if (
        get(manager, 'supportsLockFileMaintenance') &&
        packageFileConfig.lockFileMaintenance.enabled
      ) {
        // Apply lockFileMaintenance config before packageRules
        let lockFileConfig = mergeChildConfig(
          packageFileConfig,
          packageFileConfig.lockFileMaintenance
        );
        lockFileConfig.updateType = 'lockFileMaintenance';
        lockFileConfig = applyPackageRules(lockFileConfig);
        // Apply lockFileMaintenance and packageRules again
        lockFileConfig = mergeChildConfig(
          lockFileConfig,
          lockFileConfig.lockFileMaintenance
        );
        lockFileConfig = applyPackageRules(lockFileConfig);
        // Remove unnecessary objects
        for (const updateType of updateTypes) {
          delete lockFileConfig[updateType];
        }
        delete lockFileConfig.packageRules;
        delete lockFileConfig.deps;
        generateBranchName(lockFileConfig);
        updates.push(lockFileConfig);
      }
    }
  }
  return updates
    .filter((update) => update.enabled)
    .map((update) => filterConfig(update, 'branch'));
}
