import 'dotenv/config';
import { usesMongoQueue } from '../../../packages/submission-engine/src/queue.js';

if (usesMongoQueue()) await import('./mongodb.js');
else await import('./redis.js');
