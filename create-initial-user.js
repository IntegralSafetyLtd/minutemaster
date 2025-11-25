// Script to create the initial user
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

// Initialize Firebase
try {
  const serviceAccount = require('./firebase-config/serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'minutemaster-ef8d3.firebasestorage.app'
  });
  console.log('✓ Firebase initialized');
} catch (error) {
  console.error('⚠️  Firebase initialization failed:', error.message);
  process.exit(1);
}

const db = admin.firestore();

async function createInitialUser() {
  const email = 'john@alect.co.uk';
  const password = 'Alect_123';

  try {
    // Check if user already exists
    const existing = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!existing.empty) {
      console.log(`⚠️  User ${email} already exists`);
      process.exit(0);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const userData = {
      email,
      passwordHash,
      encryptedApiKey: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: null
    };

    const userRef = await db.collection('users').add(userData);

    console.log('✓ Initial user created successfully!');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    console.log(`  User ID: ${userRef.id}`);
    console.log('\n⚠️  IMPORTANT: Change this password after first login!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating user:', error);
    process.exit(1);
  }
}

createInitialUser();
