import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import xml2js from "xml2js";
import chalk from "chalk";
import inquirer from "inquirer";

const buildYamlPath = path.resolve("./build.yaml");
const streamFolder = path.resolve("./build/stream");
const metaFolder = path.resolve("./build/meta");
const ulcFilePath = path.resolve("./build/ulc.lua");

function loadYaml(filePath) {
  try {
    console.log(chalk.cyan(`Loading YAML file: ${filePath}`));
    const content = fs.readFileSync(filePath, "utf8");
    console.log(chalk.green("YAML file loaded successfully."));
    return yaml.load(content);
  } catch (err) {
    console.error(chalk.red(`Failed to load YAML: ${err.message}`));
    process.exit(1);
  }
}

async function parseXmlFile(filePath) {
  const xmlData = fs.readFileSync(filePath, "utf8");

  try {
    const result = await xml2js.parseStringPromise(xmlData);

    return result;
  } catch (err) {
    console.error(`Error parsing XML in file ${filePath}:`, err);

    return null;
  }
}

function unparseXmlFile(parsedData) {
  const builder = new xml2js.Builder();

  return builder.buildObject(parsedData);
}

async function findMetaFiles(recursive) {
  let vehicles = [];
  let carvariations = [];
  let carcols = [];
  let folder = recursive || metaFolder;
  const files = fs.readdirSync(folder);

  for (let file of files) {
    let filePath = path.join(folder, file);
    let stats = fs.lstatSync(filePath);

    if (stats.isDirectory()) {
      const {
        vehicles: subVehicles,
        carvariations: subCarvariations,
        carcols: subCarcols,
      } = await findMetaFiles(filePath);

      vehicles = [...vehicles, ...(subVehicles || [])];
      carvariations = [...carvariations, ...(subCarvariations || [])];
      carcols = [...carcols, ...(subCarcols || [])];
    } else {
      switch (file) {
        case "vehicles.meta":
          let vehicleData = await parseXmlFile(filePath);

          vehicles.push({
            path: filePath,
            contents: vehicleData,
          });
          break;

        case "carvariations.meta":
          let carvarData = await parseXmlFile(filePath);

          carvariations.push({
            path: filePath,
            contents: carvarData,
          });
          break;

        case "carcols.meta":
          let carcolData = await parseXmlFile(filePath);

          carcols.push({
            path: filePath,
            contents: carcolData,
          });
          break;

        default:
          break;
      }
    }
  }

  return { vehicles, carvariations, carcols };
}

// Helper function to ensure CRLF line endings
function convertToCRLF(content) {
  content = content.replaceAll(/\n/g, "\r\n");
  content = content.replaceAll("&#xD;", "");
  return content;
}

// Auto-increment spawn codes based on the prefix pattern
function autoIncrementSpawnCodes(vehicleEntries) {
  console.log(chalk.cyan("Auto-incrementing spawn codes..."));
  const counters = {};
  const spawnCodes = {};

  for (const [vehicle, { code }] of Object.entries(vehicleEntries)) {
    const base = code.replace(/#$/, "");
    if (!counters[base]) counters[base] = 1;

    spawnCodes[vehicle] = `${base}${counters[base]}`;
    counters[base]++;
  }

  console.log(chalk.green("Spawn codes generated successfully."));
  return spawnCodes;
}

// Rename vehicle files in the ./build/stream folder
function renameVehicleFiles(streamFolder, spawnCodes) {
  console.log(chalk.cyan("Renaming vehicle files..."));
  for (const [vehicle, spawnCode] of Object.entries(spawnCodes)) {
    const patterns = [".yft", ".ytd", "_hi.yft", "+hi.ytd"];
    patterns.forEach((ext) => {
      const oldFileName = path.join(streamFolder, `${vehicle}${ext}`);
      const newFileName = path.join(streamFolder, `${spawnCode}${ext}`);
      if (fs.existsSync(oldFileName)) {
        fs.renameSync(oldFileName, newFileName);
        console.log(chalk.green(`Renamed ${oldFileName} to ${newFileName}`));
      } else {
        console.warn(chalk.yellow(`File not found: ${oldFileName}`));
      }
    });
  }
}

// Update metadata XML files
async function updateMetaFiles(
  vehiclesArray,
  carvarArray,
  spawnCodes,
  vehicleData,
  buildData
) {
  vehiclesArray.forEach((vehicleMetaFile) => {
    let vehicleMetaFilePath = vehicleMetaFile.path;
    let vehicleMetaData = vehicleMetaFile.contents;

    vehicleMetaData.CVehicleModelInfo__InitDataList.InitDatas[0].Item.forEach(
      (item) => {
        const originalModelName = item.modelName[0].toLowerCase();
        const spawnCode = spawnCodes[originalModelName];
        if (spawnCode) {
          const dataRef = buildData[originalModelName].data;
          item.modelName[0] = spawnCode;
          item.txdName[0] = spawnCode;
          item.gameName[0] = spawnCode;
          item.handlingId[0] = vehicleData[dataRef].handling;
          item.audioNameHash[0] = vehicleData[dataRef].audio;
          console.log(
            chalk.green(`Updated vehicles.meta for ${originalModelName}`)
          );
        }
      }
    );

    fs.writeFileSync(
      vehicleMetaFilePath,
      convertToCRLF(unparseXmlFile(vehicleMetaData)),
      "utf-8"
    );
  });

  carvarArray.forEach((carvariationMetaFile) => {
    let carvarMetaFilePath = carvariationMetaFile.path;
    let carvarMetaData = carvariationMetaFile.contents;

    carvarMetaData.CVehicleModelInfoVariation.variationData[0].Item.forEach(
      (item) => {
        const originalModelName = item.modelName[0].toLowerCase();
        const spawnCode = spawnCodes[originalModelName];
        if (spawnCode) {
          item.modelName[0] = spawnCode;
          console.log(
            chalk.green(`Updated carvariations.meta for ${originalModelName}`)
          );
        }
      }
    );

    fs.writeFileSync(
      carvarMetaFilePath,
      convertToCRLF(unparseXmlFile(carvarMetaData)),
      "utf-8"
    );
  });
}

// Update carcols files
async function fixModkits(carcolArray, prefix) {
  carcolArray.forEach((carcolFile) => {
    let carcolPath = carcolFile.path;
    let carcolData = carcolFile.contents;

    // Log the start of processing the carcol file
    console.log(chalk.blue(`Processing file: ${carcolPath}`));

    try {
      carcolData?.CVehicleModelInfoVarGlobal?.Kits?.forEach((kit, kitIndex) => {
        kit.Item?.forEach((item, itemIndex) => {
          if (item.kitName != null && item.id != null) {
            // Log before updating the item id
            console.log(
              chalk.yellow(
                `Modifying kit ID: ${item.id[0]["$"].value} (Kit ${
                  kitIndex + 1
                }, Item ${itemIndex + 1})`
              )
            );

            // Add prefix to item id
            item.id[0]["$"].value = (prefix || "") + item.id[0]["$"].value;

            // Log after modification
            console.log(
              chalk.green(`Updated kit ID: ${item.id[0]["$"].value}`)
            );
          }
        });
      });
    } catch (err) {
      // Log any errors encountered during the loop
      console.log(chalk.red(`Error processing file: ${carcolPath}`));
      console.error(chalk.red(err));
    }

    // Log that the file is being written
    console.log(chalk.blue(`Writing updated file: ${carcolPath}`));

    // Write the updated data back to the file
    fs.writeFileSync(
      carcolPath,
      convertToCRLF(unparseXmlFile(carcolData)),
      "utf-8"
    );

    // Log the successful write
    console.log(chalk.green(`Successfully wrote updated file: ${carcolPath}`));
  });
}

// Update ULC script
function updateUlcFile(ulcFilePath, spawnCodes) {
  console.log(chalk.cyan("Updating ULC script..."));
  if (!fs.existsSync(ulcFilePath)) {
    console.warn(chalk.yellow(`ULC file not found: ${ulcFilePath}`));
    return;
  }

  let ulcContent = fs.readFileSync(ulcFilePath, "utf8");
  for (const [originalModelName, spawnCode] of Object.entries(spawnCodes)) {
    ulcContent = ulcContent.replaceAll(
      `"${originalModelName}"`,
      `"${spawnCode}"`
    );
    console.log(chalk.green(`Replaced ${originalModelName} with ${spawnCode}`));
  }

  fs.writeFileSync(ulcFilePath, ulcContent, "utf8");
  console.log(chalk.green("ULC script updated successfully."));
}

// Main function
async function main() {
  // Ask user for input via CLI
  const { updateChoice } = await inquirer.prompt([
    {
      type: "list",
      name: "updateChoice",
      message: "What would you like to update?",
      choices: [
        "Update everything",
        "Update only spawn codes",
        "Update only meta files",
        "Update only ULC",
        "Update only modkits",
      ],
    },
  ]);

  // Set paths and data
  const buildData = loadYaml(buildYamlPath);
  const metaData = await findMetaFiles();
  const vehicleData = buildData.data;
  const vehicleEntries = buildData.vehicles;
  const spawnCodes = autoIncrementSpawnCodes(vehicleEntries);

  // Perform the updates based on the user's choice
  switch (updateChoice) {
    case "Update everything":
      const { selectedPrefix1 } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedPrefix1",
          message: "What should be the prefix for modkit ids?",
          choices: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        },
      ]);

      renameVehicleFiles(streamFolder, spawnCodes);
      await updateMetaFiles(
        metaData.vehicles,
        metaData.carvariations,
        spawnCodes,
        vehicleData,
        vehicleEntries
      );
      updateUlcFile(ulcFilePath, spawnCodes);
      await fixModkits(metaData.carcols, selectedPrefix1);
      break;

    case "Update only spawn codes":
      renameVehicleFiles(streamFolder, spawnCodes);
      break;

    case "Update only meta files":
      await updateMetaFiles(
        metaData.vehicles,
        metaData.carvariations,
        spawnCodes,
        vehicleData,
        vehicleEntries
      );
      break;

    case "Update only ULC":
      updateUlcFile(ulcFilePath, spawnCodes);
      break;

    case "Update only modkits":
      const { selectedPrefix } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedPrefix",
          message: "What should be the prefix for modkit ids?",
          choices: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        },
      ]);
      await fixModkits(metaData.carcols, selectedPrefix);
      break;

    default:
      console.log(chalk.red("Invalid choice!"));
      break;
  }

  console.log(chalk.bold.green("Processing completed successfully."));
}

// Call main with top-level await (supported in ESM)
main().catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
});
