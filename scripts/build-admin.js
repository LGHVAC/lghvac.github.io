/**
 * 2026 HVAC Engineering Expert Seminar
 * 관리자 코어(admin-core) 암호화 빌드 & 복호화 도구
 * 
 * Usage:
 *   node scripts/build-admin.js build [암호]    # src/admin-core.html -> assets/admin-core.enc
 *   node scripts/build-admin.js decrypt [암호]  # assets/admin-core.enc -> src/admin-core.html
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_FILE = path.join(ROOT_DIR, 'src', 'admin-core.html');
const ENC_FILE = path.join(ROOT_DIR, 'assets', 'admin-core.enc');

const PBKDF2_ITERATIONS = 100000;
const KEY_LEN = 32; // 256 bits
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Encrypt plaintext string into WebCrypto-compatible AES-256-GCM buffer
 * Buffer layout: [Salt 16B] + [IV 12B] + [Ciphertext NB] + [Auth Tag 16B]
 */
function encryptPayload(plainText, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, encrypted, tag]);
}

/**
 * Decrypt WebCrypto-compatible AES-256-GCM buffer into plaintext string
 */
function decryptPayload(buffer, password) {
  if (buffer.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error('암호화 데이터 길이가 너무 짧습니다.');
  }

  const salt = buffer.subarray(0, SALT_LEN);
  const iv = buffer.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const encryptedWithTag = buffer.subarray(SALT_LEN + IV_LEN);
  const tag = encryptedWithTag.subarray(encryptedWithTag.length - TAG_LEN);
  const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - TAG_LEN);

  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function runBuild(password) {
  if (!password) {
    console.error('❌ 보안을 위해 비밀번호 입력이 필수입니다: node scripts/build-admin.js build <비밀번호>');
    process.exit(1);
  }
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`❌ 원본 소스 파일이 존재하지 않습니다: ${SRC_FILE}`);
    process.exit(1);
  }

  const plainText = fs.readFileSync(SRC_FILE, 'utf8');
  console.log(`📖 원본 소스 로드 완료 (${SRC_FILE}, ${(plainText.length / 1024).toFixed(1)} KB)`);

  const encBuffer = encryptPayload(plainText, password);
  
  // Ensure assets dir exists
  const assetsDir = path.dirname(ENC_FILE);
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  fs.writeFileSync(ENC_FILE, encBuffer);
  console.log(`🔒 암호화 번들 생성 완료: ${ENC_FILE}`);
  console.log(`   - 크기: ${(encBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`   - 암호: [보안 마스킹 처리됨] (PBKDF2 100k iters + AES-256-GCM)`);
  console.log(`   - SHA-256: ${crypto.createHash('sha256').update(encBuffer).digest('hex').slice(0, 16)}...`);
}

function runDecrypt(password) {
  if (!password) {
    console.error('❌ 보안을 위해 비밀번호 입력이 필수입니다: node scripts/build-admin.js decrypt <비밀번호>');
    process.exit(1);
  }
  if (!fs.existsSync(ENC_FILE)) {
    console.error(`❌ 암호화 파일이 존재하지 않습니다: ${ENC_FILE}`);
    process.exit(1);
  }

  const encBuffer = fs.readFileSync(ENC_FILE);
  console.log(`🔒 암호화 파일 로드 완료 (${ENC_FILE}, ${(encBuffer.length / 1024).toFixed(1)} KB)`);

  try {
    const plainText = decryptPayload(encBuffer, password);
    const srcDir = path.dirname(SRC_FILE);
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(SRC_FILE, plainText, 'utf8');
    console.log(`🔓 복호화 완료! 소스 복원 성공: ${SRC_FILE}`);
    console.log(`   - 복원 크기: ${(plainText.length / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error(`❌ 복호화 실패: 암호가 올바르지 않거나 파일이 손상되었습니다.`);
    console.error(err.message);
    process.exit(1);
  }
}

// CLI handler
const mode = (process.argv[2] || '').toLowerCase();
const pwd = process.env.ADMIN_BUNDLE_KEY || process.argv[3];

if (mode === 'build') {
  runBuild(pwd);
} else if (mode === 'decrypt') {
  runDecrypt(pwd);
} else {
  console.log('사용법:');
  console.log('  node scripts/build-admin.js build <비밀번호>   # 암호화하여 assets/admin-core.enc 생성');
  console.log('  node scripts/build-admin.js decrypt <비밀번호> # assets/admin-core.enc 복호화');
}

module.exports = { encryptPayload, decryptPayload };
