/**
 * OIDC sign-in button shown on the login page when ``oidc_enabled`` is true.
 *
 * Single responsibility: render the provider-labelled button and forward the
 * browser to ``/api/admin/oidc/login``. The backend handles state cookies,
 * the IdP roundtrip, and the final redirect back to ``/admin/oidc/callback``
 * which the SPA route consumes.
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

interface Props {
  providerLabel: string;
  disabled?: boolean;
}

export default function OidcLoginButton({ providerLabel, disabled }: Props) {
  const { t } = useTranslation();
  const label = providerLabel?.trim() || t('admin.oidc.defaultProvider');
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => {
        window.location.href = '/api/admin/oidc/login';
      }}
    >
      {t('admin.oidc.signInWith', { provider: label })}
    </Button>
  );
}
