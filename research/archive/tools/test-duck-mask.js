import { DUCK_MASK, DUCK_MASK_BITS, DUCK_SOURCES, DUCK_SOURCE_BIT, buildMaskFromBits, buildDuckMaskFrames, describeMask, duckBit } from "../duck-loopback-hid.js";

console.log("биты:", JSON.stringify(DUCK_MASK_BITS));
console.log("источники:", DUCK_SOURCES.join(", "));
console.log();

const cases = [
  [["AUX","BT","OTGIN","Playback1_2","Playback3_4","Playback5_6","Playback7_8","Playback9_10"], 255],
  [["BT","Playback1_2","Playback5_6","Playback9_10"], 170],
  [["OTGIN","Playback3_4","Playback7_8"], 84],
  [["AUX"], 1],   // AUX = бит 0
  [["BT","OTGIN","Playback1_2","Playback3_4","Playback5_6","Playback7_8","Playback9_10"], 254],  // всё кроме AUX
  [["Playback 1/2","PB34"], 8+16],   // биты 3 и 4
  [["PB910"], 128],
  [[0,2,4,6], 85],
];
let ok = 0, fail = 0;
for (const [src, expect] of cases) {
  const got = buildMaskFromBits(src);
  const good = got === expect;
  if (good) ok++; else fail++;
  console.log(`${good?"OK  ":"FAIL"}  ${JSON.stringify(src)} -> ${got} (ожидали ${expect})`);
}
console.log(`\nсборка маски: ${ok}/${ok+fail}`);

console.log("\nалиасы:");
for (const n of ["AUX","BT","OTG IN","OTG","PB12","pb34","Playback 5/6","Playback7_8","PB910","playback 9/10"]) {
  console.log(`  ${n.padEnd(16)} -> бит ${duckBit(n)}`);
}

console.log("\nнеизвестное имя:");
try { duckBit("Mix A"); console.log("  FAIL: не бросило"); } catch (e) { console.log("  OK: " + e.message); }

console.log("\nкадры:");
console.log(" ", JSON.stringify(buildDuckMaskFrames({ in1: ["AUX","BT"], in2: 84 })));
console.log(" ", JSON.stringify(buildDuckMaskFrames({ in1: 255 })));

console.log("\ndescribeMask(170):");
const d = describeMask(170);
console.log("  binary:", d.binary, " sources:", d.sources.join(", "));

console.log("\nбит вне диапазона:");
try { buildMaskFromBits([8]); console.log("  FAIL"); } catch (e) { console.log("  OK: " + e.message); }
console.log();
if (fail > 0) {
  console.log("ПРОВАЛОВ: " + fail);
  process.exit(1);
}
console.log("все проверки пройдены");
