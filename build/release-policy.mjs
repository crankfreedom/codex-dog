import { valid } from 'semver';

export function releasePolicy(mode, version, runId, environment = {}) {
  if (!['preview', 'signed-beta', 'signed-stable'].includes(mode)) throw new Error('RELEASE_MODE_INVALID');
  if (!valid(version) || !/^[a-z0-9-]{1,40}$/.test(runId)) throw new Error('RELEASE_VERSION_INVALID');
  const channel = mode === 'signed-stable' ? 'stable' : 'beta';
  if (!(channel === 'stable' ? /^\d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+-beta\.\d+$/).test(version)) throw new Error('RELEASE_CHANNEL_MISMATCH');
  const preview = mode === 'preview';
  const publisherName = environment.DOG_PUBLISHER_NAME?.trim();
  const signingNames = ['DOG_PUBLISHER_NAME', 'DOG_AZURE_ENDPOINT', 'DOG_AZURE_ACCOUNT', 'DOG_AZURE_CERTIFICATE_PROFILE', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
  if (!preview && (environment.DOG_SIGNING_ENABLED !== 'true' || signingNames.some(name => !environment[name]?.trim()))) throw new Error('SIGNING_NOT_CONFIGURED');
  if (!preview && !/^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/.test(environment.DOG_AZURE_ENDPOINT)) throw new Error('SIGNING_ENDPOINT_INVALID');
  const appId = 'io.github.crankfreedom.codexdog' + (preview ? '.preview' : channel === 'beta' ? '.beta' : '');
  const productName = preview ? 'Codex Dog Preview' : channel === 'beta' ? 'Codex Dog Beta' : 'Codex Dog';
  const executableName = preview ? 'CodexDogPreview' : channel === 'beta' ? 'CodexDogBeta' : 'CodexDog';
  const manifest = { kind: preview ? 'release-preview' : 'release', repository: 'crankfreedom/codex-dog', channel, profile: preview ? `g06-preview-${runId}` : channel === 'beta' ? 'beta' : 'default', signatureRequired: !preview, ...(preview ? {} : { publisherName }) };
  return {
    mode, version, appId, productName, executableName, channel, manifest,
    artifactName: preview ? 'Codex-Dog-Preview-${version}-Setup.${ext}' : 'Codex-Dog-${version}-Setup.${ext}',
    signing: preview ? { forceCodeSigning: false, win: { signExecutable: false, verifyUpdateCodeSignature: false } } : {
      forceCodeSigning: true,
      win: { signExecutable: true, verifyUpdateCodeSignature: true, azureSignOptions: { publisherName, endpoint: environment.DOG_AZURE_ENDPOINT, codeSigningAccountName: environment.DOG_AZURE_ACCOUNT, certificateProfileName: environment.DOG_AZURE_CERTIFICATE_PROFILE, fileDigest: 'SHA256', timestampDigest: 'SHA256', timestampRfc3161: 'http://timestamp.acs.microsoft.com' } },
    },
  };
}
