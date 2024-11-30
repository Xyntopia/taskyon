import { defineSsrMiddleware } from '#q-app/wrappers';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

type OperationType = 'add' | 'delete';

interface SignedRequest {
  operation: OperationType;
  data?: unknown; // Object to add
  id?: string; // ID to delete
  publicKey: string;
  signature: string;
}

const validateSignature = (
  data: string,
  publicKey: string,
  signature: string,
): boolean => {
  const verifier = crypto.createVerify('sha256');
  verifier.update(data);
  verifier.end();
  return verifier.verify(publicKey, signature, 'base64');
};

const operationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const body: SignedRequest = req.body;

  if (!body || !body.operation || !body.publicKey || !body.signature) {
    return res.status(400).json({ error: 'Invalid request format' });
  }

  const { operation, data, id, publicKey, signature } = body;

  try {
    // Ensure operation is valid
    if (!['add', 'delete'].includes(operation)) {
      return res.status(400).json({ error: 'Invalid operation type' });
    }

    // Serialize operation and content for signature verification
    const operationData = JSON.stringify({
      operation,
      content: operation === 'add' ? data : id,
    });

    // Validate operation signature
    if (!validateSignature(operationData, publicKey, signature)) {
      return res.status(401).json({ error: 'Invalid signature for operation' });
    }

    if (operation === 'add') {
      if (!data) {
        return res
          .status(400)
          .json({ error: 'Data is required for add operation' });
      }

      // Validate object ownership
      const objectData = JSON.stringify(data);
      if (!validateSignature(objectData, publicKey, data.signature)) {
        return res.status(401).json({ error: 'Invalid signature for object' });
      }
    }

    if (operation === 'delete' && !id) {
      return res
        .status(400)
        .json({ error: 'ID is required for delete operation' });
    }

    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/developing-ssr/ssr-middlewares
export default defineSsrMiddleware(
  async ({ app /*, resolveUrlPath, publicPath, render */ }) => {
    // something to do with the server "app"
    app.use(operationMiddleware);
  },
);
