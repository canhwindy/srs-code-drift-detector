import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';

import { apiKeyPath } from '~/utils/routeHelpers';
import SidebarLink from './SidebarLink';

// Key icon — represents API key management (inline SVG, consistent with ChatLink.tsx)
const KeyIcon = (): JSX.Element => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ display: 'block' }}
  >
    <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
  </svg>
);

/**
 * ApiKeyLink — Sidebar navigation item for the API Keys management page.
 * Follows the same pattern as ChatLink.tsx and GraphLink.tsx.
 */
export const ApiKeyLink = observer((): JSX.Element => {
  const { t } = useTranslation();

  return (
    <SidebarLink
      to={apiKeyPath()}
      icon={<KeyIcon />}
      exact={true}
      label={t('API Keys')}
    />
  );
});
