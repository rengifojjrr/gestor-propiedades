/** Una conversación a pantalla completa (en el teléfono, la bandeja abre aquí cada conversación). */
import { useParams } from 'react-router';
import { ThreadPanel } from './ThreadPanel';

export default function ThreadPage() {
  const { threadId } = useParams();
  if (!threadId) return null;
  return <ThreadPanel key={threadId} threadId={threadId} layout="page" />;
}
