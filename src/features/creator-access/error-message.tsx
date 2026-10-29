import { accessErrorMessage } from './error-copy';

export function AccessError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="creator-error" role="alert">
      {accessErrorMessage(error)}
    </p>
  );
}
