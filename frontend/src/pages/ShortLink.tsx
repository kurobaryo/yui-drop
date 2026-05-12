/**
 * ShortLink — entry hook for /s/:code.
 *
 * We could just <Navigate /> in the routes file, but this component exists so
 * we can record / log opens in the future (and shows a brief loading state
 * if React Router suspends).
 */
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';

export default function ShortLink() {
  const { code } = useParams<{ code: string }>();

  useEffect(() => {
    // Hook point: future analytics / "opened by short link" log goes here.
  }, [code]);

  if (!code) return <Navigate to="/" replace />;
  return (
    <>
      <Navigate to={`/v/${code}`} replace />
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    </>
  );
}
