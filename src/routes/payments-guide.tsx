import { createFileRoute, Link } from "@tanstack/react-router";
import { FEE_NOTICE, FEE_NOTICE_TITLE } from "@/lib/payments";

export const Route = createFileRoute("/payments-guide")({
  head: () => ({
    meta: [
      { title: "Set up automatic transfers with Monnify — NairaPlate" },
      { name: "description", content: "Step by step: connect Monnify to NairaPlate so bank transfers at your till are confirmed automatically." },
      { property: "og:title", content: "Set up automatic transfers with Monnify — NairaPlate" },
      { property: "og:description", content: "Step by step: connect Monnify to NairaPlate so bank transfers at your till are confirmed automatically." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentsGuide,
});

const L = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="underline" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold"><span className="mr-2 inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground">{n}</span>{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function PaymentsGuide() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 pb-16">
      <div className="flex items-center justify-between"><Link className="underline" to="/payments">← Payments &amp; transfers</Link><Link className="underline" to="/app">Home</Link></div>
      <h1 className="text-2xl font-bold">Set up automatic transfers with Monnify</h1>
      <p className="text-sm text-muted-foreground">
        With this switched on, a customer pays by bank transfer to a one-time account number shown on your till, and the order turns <b>Paid</b> by itself when the money arrives.
        Nobody, including you, can mark a transfer order paid by hand. Monnify is Moniepoint's payment service for businesses. It is a separate account from your Moniepoint business bank account.
        Allow about 20 minutes for the test, and do the test first: <b>no real money moves in test mode</b>.
      </p>
      <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
        The Monnify dashboard changes from time to time, so button names may differ a little from what is written here. If you cannot find something, search Monnify's help pages or ask their support.
        Never send your secret key to anyone, including NairaPlate staff. You type it only on the NairaPlate Payments screen.
      </p>

      <Step n={1} title="Create a Monnify account">
        <p>Sign up on Monnify with your email, phone number and business name. See Monnify's guide: <L href="https://support.monnify.com/topics/getting-started-211/sign-up-on-monnify-485">Sign up on Monnify</L>.</p>
        <p>Monnify has a <b>test mode</b> (a sandbox) where no real money moves. Use it first, and check the dashboard shows you are in test mode. See <L href="https://support.monnify.com/topics/getting-started-211/understanding-test-vs-live-mode-505">Understanding test vs live mode</L>.</p>
      </Step>

      <Step n={2} title="Find your three test keys">
        <p>On the Monnify dashboard, while it is in test mode, find these three things. They are usually under a Settings or Developer area:</p>
        <ul className="list-disc pl-5"><li><b>API key</b></li><li><b>Secret key</b></li><li><b>Contract code</b></li></ul>
        <p>Keep this page open and keep the keys private. Test keys and live keys are different. Use test keys while you are in test mode.</p>
      </Step>

      <Step n={3} title="Connect them in NairaPlate">
        <p>On NairaPlate, sign in as the <b>owner</b>, open <b>Oversight → Payments &amp; transfers</b>, and fill in the <b>Payment provider: Monnify</b> box.</p>
        <ul className="list-disc pl-5"><li>Choose <b>Test (no real money)</b>.</li><li>Paste the API key, secret key and contract code.</li><li>Press <b>Check and connect</b>.</li></ul>
        <p>NairaPlate checks the keys with Monnify and stores them encrypted. You will see "Monnify connected". If it says Monnify did not accept the keys, check you copied test keys, with no spaces at the ends.</p>
      </Step>

      <Step n={4} title="Tell Monnify where to send payment news (the webhook)">
        <p>On the same NairaPlate screen, find the <b>Webhook address</b> and copy it.</p>
        <p>On the Monnify dashboard, find the setting for <b>transaction notifications / webhooks</b> and paste that address there. Save it. This is how Monnify tells NairaPlate that money arrived. Without it, orders will wait forever.</p>
      </Step>

      <Step n={5} title="Switch automatic transfers on">
        <p>Back on the NairaPlate Payments screen, under <b>How transfers are taken at your till</b>, choose <b>Transfers confirmed automatically</b>. Confirm the warning.</p>
        <p className="rounded-md bg-muted p-3 text-foreground"><b>{FEE_NOTICE_TITLE}.</b> {FEE_NOTICE}</p>
        <p>From then on, the till shows Cash, <b>Transfer (automatic)</b> and Customer credit. The typed-in transfer and split choices are removed, because they cannot be checked.</p>
      </Step>

      <Step n={6} title="Try a test sale">
        <ol className="list-decimal pl-5">
          <li>On the Till, add a dish and choose <b>Transfer (automatic)</b>, then press the button.</li>
          <li>An account number and the exact amount appear under <b>Waiting for payment</b>.</li>
          <li>In Monnify's sandbox, simulate a transfer of that exact amount to that account. Monnify explains how: <L href="https://developers.monnify.com/blog/testing-pay-with-transfer-on-monnify-sandbox">Testing pay with transfer on the Monnify sandbox</L>.</li>
          <li>Within a few seconds the panel on the till should disappear and the order should show as Paid in Orders.</li>
        </ol>
        <p>If it stays waiting, check step 4 (the webhook address) first.</p>
      </Step>

      <Step n={7} title="Go live (real money)">
        <p>Monnify must approve your business before real payments work. They ask for business documents, for example CAC registration and compliance papers, and the list can depend on your business. See <L href="https://monnify-docs.playground.monnify.com/docs/live">Going live</L>, or ask Monnify support what a small shop needs.</p>
        <p>When approved, find your <b>live</b> keys, go back to <b>Payments &amp; transfers</b>, choose <b>Live (real money)</b>, paste the live keys and press <b>Check and connect</b>. Update the webhook address on the Monnify live dashboard too.</p>
        <p>Until Monnify approves you, keep the shop on test mode, or on <b>Cash and credit only</b>.</p>
      </Step>

      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">If something looks wrong</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li><b>Customer paid but the till still waits:</b> check the webhook address on Monnify, and that you are using matching test or live keys. You will also get an alert if money arrives for an order that is cancelled or already paid.</li>
          <li><b>Part payment:</b> the till shows how much is still to pay. The customer sends the rest.</li>
          <li><b>Customer left:</b> cancel the order on the till and type the reason. The stock is put back. Cancelled orders are kept in your audit log.</li>
          <li><b>Need help:</b> message us on WhatsApp +234 912 476 6666.</li>
        </ul>
      </section>
    </main>
  );
}
