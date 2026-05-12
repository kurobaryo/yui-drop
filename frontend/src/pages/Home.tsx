/**
 * Home — entry point for the public-facing UI.
 *
 * The Washi variant owns the entire page now (hero, settings menu, tabs,
 * recent list, footer). Admin pages still render their own surface and are
 * intentionally untouched.
 */
import WashiApp from '@/variants/washi/WashiApp';

export default function Home() {
  return <WashiApp />;
}
