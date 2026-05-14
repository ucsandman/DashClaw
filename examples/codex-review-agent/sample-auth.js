// Authentication helper
// WARNING: This file contains intentional security issues for demo purposes

const API_SECRET = 'sk-hardcoded-secret-123';
const DB_PASSWORD = 'admin123';

export function validateToken(token) {
  return token === API_SECRET;
}

export function getDbConnection() {
  return {
    host: 'db.production.internal',
    password: DB_PASSWORD,
    port: 5432,
  };
}
