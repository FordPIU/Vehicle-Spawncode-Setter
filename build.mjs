import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import xml2js from "xml2js";
import chalk from "chalk";
import inquirer from "inquirer";

// Load the build.yaml file
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
async function updateMetaFiles(metaFolder, spawnCodes, vehicleData, buildData) {
  console.log(chalk.cyan("Updating metadata files..."));
  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder();

  const metaFiles = ["vehicles.meta", "carvariations.meta"];
  for (const file of metaFiles) {
    const filePath = path.join(metaFolder, file);
    if (!fs.existsSync(filePath)) {
      console.warn(chalk.yellow(`Metadata file not found: ${file}`));
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const parsedXml = await parser.parseStringPromise(content);

    // Process vehicles
    if (file === "vehicles.meta") {
      parsedXml.CVehicleModelInfo__InitDataList.InitDatas[0].Item.forEach(
        (item) => {
          const originalModelName = item.modelName[0];
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
    }

    if (file === "carvariations.meta") {
      parsedXml.CVehicleModelInfoVariation.variationData[0].Item.forEach(
        (item) => {
          const originalModelName = item.modelName[0];
          const spawnCode = spawnCodes[originalModelName];
          if (spawnCode) {
            item.modelName[0] = spawnCode;
            console.log(
              chalk.green(`Updated carvariations.meta for ${originalModelName}`)
            );
          }
        }
      );
    }

    const updatedContent = builder.buildObject(parsedXml);
    fs.writeFileSync(filePath, updatedContent, "utf8");
    console.log(chalk.green(`Updated ${file}`));
  }
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
    ulcContent = ulcContent.replaceAll(originalModelName, spawnCode);
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
      ],
    },
  ]);

  // Set paths and data
  const buildYamlPath = path.resolve("./build.yaml");
  const buildData = loadYaml(buildYamlPath);

  const streamFolder = path.resolve("./build/stream");
  const metaFolder = path.resolve("./build/meta");
  const ulcFilePath = path.resolve("./build/ulc.lua");

  const vehicleData = buildData.data;
  const vehicleEntries = buildData.vehicles;

  const spawnCodes = autoIncrementSpawnCodes(vehicleEntries);

  // Perform the updates based on the user's choice
  switch (updateChoice) {
    case "Update everything":
      renameVehicleFiles(streamFolder, spawnCodes);
      await updateMetaFiles(
        metaFolder,
        spawnCodes,
        vehicleData,
        vehicleEntries
      );
      updateUlcFile(ulcFilePath, spawnCodes);
      break;

    case "Update only spawn codes":
      renameVehicleFiles(streamFolder, spawnCodes);
      break;

    case "Update only meta files":
      await updateMetaFiles(
        metaFolder,
        spawnCodes,
        vehicleData,
        vehicleEntries
      );
      break;

    case "Update only ULC":
      updateUlcFile(ulcFilePath, spawnCodes);
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
