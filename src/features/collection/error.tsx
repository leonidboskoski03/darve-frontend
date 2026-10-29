import { collectionErrorMessage } from './error-message';
export function CollectionProblem({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="collection-problem">
      {collectionErrorMessage(error)}
    </p>
  ) : null;
}
