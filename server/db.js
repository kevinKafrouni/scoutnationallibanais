import 'dotenv/config';
import pg from 'pg';
import { databaseConfig } from './db-config.js';
export const db = new pg.Pool(databaseConfig(process.env));
db.on('error', () => console.error('An idle database connection failed.'));
