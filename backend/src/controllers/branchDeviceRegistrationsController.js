import {
  buildBranchDeviceRegistrationErrorResponse,
  createOrUpdateBranchDeviceRegistration,
  getBranchDeviceRegistrationMe,
  listBranchDeviceRegistrations,
  patchBranchDeviceRegistration,
} from '../services/branchDeviceRegistrationsService.js';

function sendBranchDeviceRegistrationError(res, error) {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const response = buildBranchDeviceRegistrationErrorResponse(error, { isProd });
  if (response.status >= 500) {
    console.error(error);
  }
  return res.status(response.status).json(response.body);
}

export async function createOrUpdateBranchDeviceRegistrationHandler(req, res) {
  try {
    const result = await createOrUpdateBranchDeviceRegistration({
      body: req.body,
      headers: req.headers,
      user: req.user,
    });
    return res.status(result.action === 'created' ? 201 : 200).json({ ok: true, ...result });
  } catch (error) {
    return sendBranchDeviceRegistrationError(res, error);
  }
}

export async function listBranchDeviceRegistrationsHandler(req, res) {
  try {
    const result = await listBranchDeviceRegistrations({
      status: req.query?.status,
      branchId: req.query?.branch_id,
      lineUserId: req.query?.line_user_id,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendBranchDeviceRegistrationError(res, error);
  }
}

export async function getBranchDeviceRegistrationMeHandler(req, res) {
  try {
    const result = await getBranchDeviceRegistrationMe({
      headers: req.headers,
      body: req.body,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendBranchDeviceRegistrationError(res, error);
  }
}

export async function patchBranchDeviceRegistrationHandler(req, res) {
  try {
    const registration = await patchBranchDeviceRegistration({
      registrationId: req.params?.id,
      body: req.body,
      user: req.user,
    });
    return res.json({ ok: true, registration });
  } catch (error) {
    return sendBranchDeviceRegistrationError(res, error);
  }
}
