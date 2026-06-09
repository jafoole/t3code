import { GithubIcon, Loader2Icon } from "lucide-react";
import { isGithubDemoMode, useGithubAuthStore } from "./githubAuthStore";
import { Button } from "../ui/button";

export function GithubSignInScreen() {
  const status = useGithubAuthStore((s) => s.status);
  const userCode = useGithubAuthStore((s) => s.userCode);
  const verificationUri = useGithubAuthStore((s) => s.verificationUri);
  const error = useGithubAuthStore((s) => s.error);
  const { startSignIn, cancelSignIn, signOut: _signOut } = useGithubAuthStore.getState();

  const openGithub = () => {
    // In demo mode, don't open the real GitHub device page.
    if (isGithubDemoMode()) return;
    if (verificationUri) {
      void window.desktopBridge?.openExternal(verificationUri).catch(() => undefined);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <img
            alt="Pallet"
            className="mx-auto mb-6 size-14 object-contain"
            src="/apple-touch-icon.png"
          />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome to Pallet
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with GitHub to access the Sortly prototypes repository.
          </p>
        </div>

        {(status === "signed-out" || status === "loading") && (
          <Button
            className="w-full gap-2"
            disabled={status === "loading"}
            onClick={() => void startSignIn()}
          >
            {status === "loading" ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <GithubIcon className="size-4" />
            )}
            Sign in with GitHub
          </Button>
        )}

        {status === "awaiting-approval" && userCode && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Your code
              </p>
              <p className="font-mono text-3xl font-bold tracking-[0.2em] text-foreground">
                {userCode}
              </p>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Enter this code at GitHub to authorize Pallet.
            </p>
            <Button className="w-full gap-2" onClick={openGithub}>
              <GithubIcon className="size-4" />
              Open GitHub to authorize
            </Button>
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              <span className="text-sm">Waiting for authorization…</span>
            </div>
            <div className="text-center">
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={cancelSignIn}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "setting-up" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Cloning your prototypes repo…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive">{error ?? "Something went wrong."}</p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                useGithubAuthStore.setState({ status: "signed-out", error: undefined });
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
