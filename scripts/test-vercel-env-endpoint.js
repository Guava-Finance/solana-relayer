// Temporary debug endpoint to test Vercel environment variables
// Add this to pages/api/debug-env.js temporarily

export default function handler(req, res) {
  const hasSecret = !!process.env.REQUEST_SIGNING_SECRET;
  const secretLength = process.env.REQUEST_SIGNING_SECRET?.length || 0;
  const secretPreview = process.env.REQUEST_SIGNING_SECRET?.substring(0, 10) + '...' || 'NOT_SET';
  
  res.status(200).json({
    hasRequestSigningSecret: hasSecret,
    secretLength: secretLength,
    secretPreview: secretPreview,
    enableRequestSigning: process.env.ENABLE_REQUEST_SIGNING,
    environment: process.env.NODE_ENV || 'unknown'
  });
}
