/**
 * Refuse to run unless the services are actually up.
 *
 * ==================== WHY THIS FAILS RATHER THAN SKIPS ====================
 * An integration suite that skips when it cannot reach anything reports
 * success, and a green run means nothing was checked. That is the same failure
 * this suite exists to catch: something that looks like it works because
 * nothing looked.
 *
 * So it throws, and says exactly what to start. `npm run test:integration`
 * either exercises two live services or tells you why it could not.
 * =========================================================================
 */

import * as path from 'path';

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const API = process.env.INTEGRATION_API_URL ?? 'http://127.0.0.1:3001';
const ML = process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8020';

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    // Any answer means something is listening and routing. 401 from a guarded
    // endpoint is a perfectly good sign of life.
    return response.status > 0;
  } catch {
    return false;
  }
}

module.exports = async function globalSetup() {
  const [apiUp, mlUp] = await Promise.all([
    reachable(`${API}/topics`),
    reachable(`${ML}/health`),
  ]);

  if (apiUp && mlUp) return;

  const down = [
    !apiUp && `  API        ${API}      cd backend && npm run start:dev`,
    !mlUp && `  ML service ${ML}      cd backend/ml && python app/main.py`,
  ].filter(Boolean);

  throw new Error(
    '\n\nThese tests talk to running services, and one is not up:\n\n' +
      `${down.join('\n')}\n\n` +
      'They are separate from `npm test` for exactly this reason - the unit\n' +
      'suite is hermetic and this one is not.\n',
  );
};
