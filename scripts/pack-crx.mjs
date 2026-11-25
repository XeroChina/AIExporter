/*
 * npm run pack:crx
 *
 * Wraps the Chrome zip built by `npm run build:chrome && npm run archive`
 * into a signed CRX3 package (AIExporter-<version>-chrome.crx).
 *
 * Reuses ai-exporter.pem in the repo root if present (so the Chrome
 * extension ID stays stable across rebuilds), or generates a new
 * RSA-2048 keypair on first run. Zero external dependencies.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "dist", "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("dist/manifest.json not found. Run `npm run build:chrome` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const zipName = `AIExporter-${manifest.version}-chrome.zip`;
const zipPath = join(root, zipName);

if (!existsSync(zipPath)) {
  console.error(`${zipName} not found. Run \`npm run archive\` first.`);
  process.exit(1);
}

const keyPath = join(root, "ai-exporter.pem");
let privateKey;

if (existsSync(keyPath)) {
  privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
} else {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
  privateKey = createPrivateKey(pair.privateKey);
  console.log(`Generated signing key: ai-exporter.pem`);
}

const publicKey = createPublicKey(privateKey);
const publicKeyDer = publicKey.export({ type: "spki", format: "der" });

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber, payload) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const length = encodeVarint(payload.length);
  return Buffer.concat([tag, length, payload]);
}

const crxId = createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
const signedHeaderData = encodeLengthDelimited(1, crxId);

const zipBuffer = readFileSync(zipPath);
const signedDataPrefix = Buffer.from("CRX3 SignedData\x00", "ascii");
const signedDataLen = Buffer.alloc(4);
signedDataLen.writeUInt32LE(signedHeaderData.length, 0);

const signer = createSign("RSA-SHA256");
signer.update(signedDataPrefix);
signer.update(signedDataLen);
signer.update(signedHeaderData);
signer.update(zipBuffer);
const signature = signer.sign(privateKey);

// Self-verify signature before writing
const verifier = createVerify("RSA-SHA256");
verifier.update(signedDataPrefix);
verifier.update(signedDataLen);
verifier.update(signedHeaderData);
verifier.update(zipBuffer);
if (!verifier.verify(publicKey, signature)) {
  console.error("CRX3 signature verification failed.");
  process.exit(1);
}

const asymmetricKeyProof = Buffer.concat([
  encodeLengthDelimited(1, publicKeyDer),
  encodeLengthDelimited(2, signature),
]);

const crxFileHeader = Buffer.concat([
  encodeLengthDelimited(2, asymmetricKeyProof),
  encodeLengthDelimited(10000, signedHeaderData),
]);

const preamble = Buffer.alloc(12);
preamble.write("Cr24", 0, "ascii");
preamble.writeUInt32LE(3, 4);
preamble.writeUInt32LE(crxFileHeader.length, 8);

const crxBuffer = Buffer.concat([preamble, crxFileHeader, zipBuffer]);
const crxName = `AIExporter-${manifest.version}-chrome.crx`;
const crxPath = join(root, crxName);

writeFileSync(crxPath, crxBuffer);

const extensionId = [...crxId]
  .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 0x0f)))
  .join("");

console.log(
  `Created ${crxName} (${Math.round(crxBuffer.length / 1024)} KB, extension ID: ${extensionId})`,
);
