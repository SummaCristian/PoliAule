const fs = require("fs");

const API_URL = "https://onlineservices.polimi.it/maps_rest/rest/ricerca/aula/occupazione";

async function main() {
  const raw = fs.readFileSync("data/classrooms.json", "utf-8");
  const data = JSON.parse(raw);

  const leonardo = data.find((campus) => campus.name === "SEDE LEONARDO");
  if (!leonardo) {
    console.error("SEDE LEONARDO not found");
    process.exit(1);
  }

  for (const building of leonardo.buildings) {
    for (const classroom of building.classrooms) {
      try {
        const res = await fetch(`${API_URL}/${classroom.id}/20260313`);
        const body = await res.json();
        console.log(`[${building.name}] ${classroom.name} (${classroom.id}):`, body);
      } catch (err) {
        console.error(`[${building.name}] ${classroom.name} (${classroom.id}): ERROR -`, err.message);
      }
    }
  }
}

main();