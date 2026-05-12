/**
 * NotFound — minimal 404 with a "go home" CTA.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="text-6xl font-bold text-[--text-1]">404</div>
      <p className="mt-3 text-[--text-2]">{t('notFound.title')}</p>
      <Button
        variant="outline"
        size="md"
        className="mt-6"
        onClick={() => navigate('/')}
      >
        {t('notFound.back')}
      </Button>
    </main>
  );
}
