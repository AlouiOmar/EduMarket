import mongoose, { Schema } from 'mongoose';

/**
 * LTI 1.3 (EduMarket as platform). Tools are registered by an administrator; a launch is a short-lived, single-use record tying
 * the OIDC login to the user who started it; service access tokens and assertion ids (jti) are stored to prevent replay.
 */
const toolSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  clientId: { type: String, required: true, unique: true },
  deploymentId: { type: String, required: true },
  oidcLoginUrl: { type: String, required: true, maxlength: 2000 },
  targetLinkUri: { type: String, required: true, maxlength: 2000 },
  redirectUris: { type: [String], default: [] },
  // Tool key for its signed messages (service token requests): a JWKS URL or a PEM public key.
  jwksUrl: { type: String, default: '', maxlength: 2000 },
  publicKeyPem: { type: String, default: '', maxlength: 10000 },
  // Data minimization: name and e-mail are only sent when the administrator enables it for this tool.
  privacy: { sendName: { type: Boolean, default: false }, sendEmail: { type: Boolean, default: false } },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });

const launchSchema = new Schema({
  toolId: { type: Schema.Types.ObjectId, ref: 'LtiTool', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  itemId: { type: String, required: true },
  role: { type: String, enum: ['learner', 'instructor'], required: true },
  loginHint: { type: String, required: true, unique: true },
  usedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });
launchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

const replaySchema = new Schema({ toolId: { type: Schema.Types.ObjectId, required: true }, jti: { type: String, required: true }, expiresAt: { type: Date, required: true } }, { versionKey: false });
replaySchema.index({ toolId: 1, jti: 1 }, { unique: true });
replaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const accessTokenSchema = new Schema({ tokenHash: { type: String, required: true, unique: true }, toolId: { type: Schema.Types.ObjectId, required: true }, scopes: { type: [String], default: [] }, expiresAt: { type: Date, required: true } }, { versionKey: false });
accessTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LtiTool = mongoose.model('LtiTool', toolSchema);
export const LtiLaunch = mongoose.model('LtiLaunch', launchSchema);
export const LtiReplay = mongoose.model('LtiReplay', replaySchema);
export const LtiAccessToken = mongoose.model('LtiAccessToken', accessTokenSchema);
