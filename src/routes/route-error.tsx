export function RouteError() {
  return (
    <main className="message-page" id="main-content">
      <p className="eyebrow">Something went wrong</p>
      <h1>We couldn’t open this page.</h1>
      <p>Reload the page to try again. No action has been confirmed here.</p>
      <a className="text-link" href="/">
        Return to Darve
      </a>
    </main>
  );
}
