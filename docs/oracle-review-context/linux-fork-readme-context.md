# Oracle review context: Linux support + fork README

Generated: 2026-04-15T08:35:25+07:00

## Git remotes
```text
origin	git@github.com:huynguyendinhquang/pi-oracle.git (fetch)
origin	git@github.com:huynguyendinhquang/pi-oracle.git (push)
upstream	https://github.com/fitchmultz/pi-oracle (fetch)
upstream	https://github.com/fitchmultz/pi-oracle (push)
```

## Branch and status
```text
* feat/oracle-wsl-support 4285690 Release 0.6.3
  main                    4285690 [upstream/main] Release 0.6.3

 M README.md
 M extensions/oracle/lib/config.ts
 M extensions/oracle/lib/runtime.ts
 M extensions/oracle/worker/auth-bootstrap.mjs
 M extensions/oracle/worker/run-job.mjs
 M package-lock.json
 M package.json
 M scripts/oracle-sanity.ts
?? .pi-lens/
?? docs/ORACLE_WSL_PORT_HANDOFF.md
?? docs/oracle-review-context/
?? docs/superpowers/
```

## Diff stat vs upstream/main
```text
 README.md                                   |  13 +--
 extensions/oracle/lib/config.ts             |  34 ++++++-
 extensions/oracle/lib/runtime.ts            |   2 +-
 extensions/oracle/worker/auth-bootstrap.mjs | 152 ++++++++++++++++++++++------
 extensions/oracle/worker/run-job.mjs        |   2 +-
 package-lock.json                           |  14 ++-
 package.json                                |  12 ++-
 scripts/oracle-sanity.ts                    |  11 +-
 8 files changed, 184 insertions(+), 56 deletions(-)
```

## Patch vs upstream/main (relevant files)
```diff
diff --git a/README.md b/README.md
index d07171f..53c0625 100644
--- a/README.md
+++ b/README.md
@@ -11,7 +11,7 @@ Use it when you want:
 
 Normal oracle jobs run in an isolated browser profile, not your active Chrome window.
 
-> Status: experimental public beta. Validated primarily on macOS with Google Chrome and `pi` 0.65.0+.
+> Status: experimental public beta. This fork is intended to work on macOS and WSL/Linux with Google Chrome and `pi` 0.65.0+.
 
 ## When to use it
 
@@ -37,16 +37,16 @@ pi install npm:pi-oracle
 GitHub:
 
 ```bash
-pi install https://github.com/fitchmultz/pi-oracle
+pi install https://github.com/huynguyendinhquang/pi-oracle
 ```
 
 ## Quickstart
 
 1. Start a normal persisted `pi` session. Do not use `pi --no-session` for oracle.
-2. Make sure ChatGPT already works in your local Chrome profile.
+2. Make sure ChatGPT already works in your local Chrome profile. On WSL, use Google Chrome inside WSL rather than Windows Chrome.
 3. Make sure these are installed: Google Chrome, `agent-browser`, `tar`, and `zstd`.
 4. Optional: create `~/.pi/agent/extensions/oracle.json` if you want non-default settings.
-5. Run `/oracle-auth`.
+5. Run `/oracle-auth`. If cookie import is unavailable, it can fall back to a one-time manual login in the isolated oracle auth browser.
 6. Run `/oracle Review the current pending changes. Include the whole repo unless a narrower archive is clearly better.`
 7. Wait for a best-effort wake-up, or check `/oracle-status`.
 
@@ -97,7 +97,7 @@ If concurrency is full, the job is queued and starts automatically later.
 User-facing commands:
 - `/oracle <request>` — prompt template that tells the agent to gather context and dispatch an oracle job
 - `/oracle-followup <job-id> <request>` — prompt template that continues an earlier oracle job in the same ChatGPT thread
-- `/oracle-auth` — sync ChatGPT cookies from your real Chrome profile into the isolated oracle auth profile
+- `/oracle-auth` — sync ChatGPT cookies from your configured Chrome profile into the isolated oracle auth profile, with a manual-login fallback when cookie import is unavailable
 - `/oracle-read [job-id]` — inspect job status plus the saved response preview
 - `/oracle-status [job-id]` — inspect job status and list recent job ids when no explicit id is given
 - `/oracle-cancel <job-id>` — cancel a queued or active job by id
@@ -171,7 +171,7 @@ Project config should only override safe, non-privileged settings.
 
 ## Requirements
 
-- macOS
+- macOS or WSL/Linux
 - Node.js 22 or newer
 - Google Chrome installed
 - ChatGPT already signed into a local Chrome profile
@@ -185,6 +185,7 @@ Project config should only override safe, non-privileged settings.
 
 - Make sure ChatGPT works in the same local Chrome profile you configured.
 - Re-run `/oracle-auth`.
+- If cookie import is unavailable, complete the one-time manual login in the isolated auth browser when it opens.
 - If ChatGPT is half-logged-in or challenge flow state looks weird, finish the login/challenge in the headed auth browser and retry.
 
 ### You hit a challenge / verification page
diff --git a/extensions/oracle/lib/config.ts b/extensions/oracle/lib/config.ts
index 895ddc6..d515814 100644
--- a/extensions/oracle/lib/config.ts
+++ b/extensions/oracle/lib/config.ts
@@ -184,8 +184,11 @@ export type OracleCloneStrategy = (typeof CLONE_STRATEGIES)[number];
 
 const ALLOWED_CHATGPT_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
 const PROJECT_OVERRIDE_KEYS = new Set(["defaults", "worker", "poller", "artifacts", "cleanup"]);
+const CURRENT_PLATFORM = process.platform;
 const DEFAULT_MAC_CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
+const DEFAULT_LINUX_CHROME_EXECUTABLE_CANDIDATES = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"] as const;
 const DEFAULT_MAC_CHROME_USER_DATA_DIR = join(homedir(), "Library", "Application Support", "Google", "Chrome");
+const DEFAULT_LINUX_CHROME_USER_DATA_DIR = join(homedir(), ".config", "google-chrome");
 
 export interface OracleConfig {
   defaults: {
@@ -226,24 +229,44 @@ export interface OracleConfig {
   };
 }
 
+function defaultChromeExecutableCandidates(): readonly string[] {
+  if (CURRENT_PLATFORM === "darwin") return [DEFAULT_MAC_CHROME_EXECUTABLE];
+  if (CURRENT_PLATFORM === "linux") return DEFAULT_LINUX_CHROME_EXECUTABLE_CANDIDATES;
+  return [];
+}
+
+function defaultChromeUserDataDir(): string | undefined {
+  if (CURRENT_PLATFORM === "darwin") return DEFAULT_MAC_CHROME_USER_DATA_DIR;
+  if (CURRENT_PLATFORM === "linux") return DEFAULT_LINUX_CHROME_USER_DATA_DIR;
+  return undefined;
+}
+
+function defaultCloneStrategy(): OracleCloneStrategy {
+  return CURRENT_PLATFORM === "darwin" ? "apfs-clone" : "copy";
+}
+
 function detectDefaultChromeExecutablePath(): string | undefined {
-  return existsSync(DEFAULT_MAC_CHROME_EXECUTABLE) ? DEFAULT_MAC_CHROME_EXECUTABLE : undefined;
+  return defaultChromeExecutableCandidates().find((candidate) => existsSync(candidate));
 }
 
 function detectDefaultChromeUserAgent(executablePath: string | undefined): string | undefined {
   if (!executablePath) return undefined;
+  const platformSegment = CURRENT_PLATFORM === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : CURRENT_PLATFORM === "linux" ? "X11; Linux x86_64" : undefined;
+  if (!platformSegment) return undefined;
   try {
     const versionOutput = execFileSync(executablePath, ["--version"], { encoding: "utf8" }).trim();
     const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+\.\d+)/);
     if (!versionMatch) return undefined;
-    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versionMatch[1]} Safari/537.36`;
+    return `Mozilla/5.0 (${platformSegment}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versionMatch[1]} Safari/537.36`;
   } catch {
     return undefined;
   }
 }
 
 function detectDefaultChromeProfileName(): string {
-  const localStatePath = join(DEFAULT_MAC_CHROME_USER_DATA_DIR, "Local State");
+  const userDataDir = defaultChromeUserDataDir();
+  if (!userDataDir) return "Default";
+  const localStatePath = join(userDataDir, "Local State");
   if (!existsSync(localStatePath)) return "Default";
   try {
     const localState = JSON.parse(readFileSync(localStatePath, "utf8")) as { profile?: { last_used?: string } };
@@ -258,6 +281,7 @@ const detectedChromeExecutablePath = detectDefaultChromeExecutablePath();
 const detectedChromeUserAgent = detectDefaultChromeUserAgent(detectedChromeExecutablePath);
 const agentExtensionsDir = join(getAgentDir(), "extensions");
 const detectedChromeProfileName = detectDefaultChromeProfileName();
+const detectedChromeUserDataDir = defaultChromeUserDataDir();
 
 export interface OracleConfigLoadDetails {
   agentDir: string;
@@ -317,7 +341,7 @@ export const DEFAULT_CONFIG: OracleConfig = {
     authSeedProfileDir: join(agentExtensionsDir, "oracle-auth-seed-profile"),
     runtimeProfilesDir: join(agentExtensionsDir, "oracle-runtime-profiles"),
     maxConcurrentJobs: 2,
-    cloneStrategy: "apfs-clone",
+    cloneStrategy: defaultCloneStrategy(),
     chatUrl: "https://chatgpt.com/",
     authUrl: "https://chatgpt.com/auth/login",
     runMode: "headless",
@@ -405,7 +429,7 @@ function expectSafeProfilePath(pathValue: string, path: string): string {
   if (pathValue === "/" || pathValue === homedir()) {
     throw new Error(`Invalid oracle config: ${path} points to an unsafe directory`);
   }
-  if (pathValue === DEFAULT_MAC_CHROME_USER_DATA_DIR || pathValue.startsWith(`${DEFAULT_MAC_CHROME_USER_DATA_DIR}/`)) {
+  if (detectedChromeUserDataDir && (pathValue === detectedChromeUserDataDir || pathValue.startsWith(`${detectedChromeUserDataDir}/`))) {
     throw new Error(`Invalid oracle config: ${path} must not point into the real Chrome user-data directory`);
   }
   return pathValue;
diff --git a/extensions/oracle/lib/runtime.ts b/extensions/oracle/lib/runtime.ts
index 6e6dcf5..6e932c7 100644
--- a/extensions/oracle/lib/runtime.ts
+++ b/extensions/oracle/lib/runtime.ts
@@ -16,7 +16,7 @@ import { createLease, listLeaseMetadata, readLeaseMetadata, releaseLease, withAu
 const SEED_GENERATION_FILE = ".oracle-seed-generation";
 const DEFAULT_ORACLE_JOBS_DIR = "/tmp";
 const ORACLE_JOBS_DIR = process.env.PI_ORACLE_JOBS_DIR?.trim() || DEFAULT_ORACLE_JOBS_DIR;
-const AGENT_BROWSER_BIN = [process.env.AGENT_BROWSER_PATH, "/opt/homebrew/bin/agent-browser", "/usr/local/bin/agent-browser"].find(
+const AGENT_BROWSER_BIN = [process.env.AGENT_BROWSER_PATH, "/opt/homebrew/bin/agent-browser", "/usr/local/bin/agent-browser", "/usr/bin/agent-browser"].find(
   (candidate) => typeof candidate === "string" && candidate && existsSync(candidate),
 ) || "agent-browser";
 const PROFILE_CLONE_TIMEOUT_MS = 120_000;
diff --git a/extensions/oracle/worker/auth-bootstrap.mjs b/extensions/oracle/worker/auth-bootstrap.mjs
index b3e257c..9e59664 100644
--- a/extensions/oracle/worker/auth-bootstrap.mjs
+++ b/extensions/oracle/worker/auth-bootstrap.mjs
@@ -1,8 +1,8 @@
-// Purpose: Bootstrap isolated oracle browser auth by importing real Chrome cookies and validating ChatGPT session readiness.
-// Responsibilities: Copy/import cookies, classify auth pages, drive lightweight account-selection flows, and persist diagnostics for auth failures.
+// Purpose: Bootstrap isolated oracle browser auth by importing configured Chrome cookies or capturing a manual login into the seed profile.
+// Responsibilities: Copy/import cookies, classify auth pages, drive lightweight account-selection flows, support manual-login fallback, and persist diagnostics for auth failures.
 // Scope: Auth bootstrap worker only; long-running oracle job execution stays in run-job.mjs and shared lifecycle/state helpers stay elsewhere.
 // Usage: Spawned by /oracle-auth to prepare the shared auth seed profile used by future oracle jobs.
-// Invariants/Assumptions: Runs against a local macOS Chrome profile, preserves private diagnostics, and must fail clearly when auth state cannot be verified.
+// Invariants/Assumptions: Runs against a configured local Chrome profile, preserves private diagnostics, and must fail clearly when auth state cannot be verified.
 import { withLock } from "./state-locks.mjs";
 import { spawn } from "node:child_process";
 import { existsSync } from "node:fs";
@@ -56,11 +56,15 @@ let URL_PATH = "(oracle-auth url path unavailable)";
 let SNAPSHOT_PATH = "(oracle-auth snapshot path unavailable)";
 let BODY_PATH = "(oracle-auth body path unavailable)";
 let SCREENSHOT_PATH = "(oracle-auth screenshot path unavailable)";
-const REAL_CHROME_USER_DATA_DIR = resolve(homedir(), "Library", "Application Support", "Google", "Chrome");
+const REAL_CHROME_USER_DATA_DIR = process.platform === "darwin"
+  ? resolve(homedir(), "Library", "Application Support", "Google", "Chrome")
+  : process.platform === "linux"
+    ? resolve(homedir(), ".config", "google-chrome")
+    : undefined;
 const DEFAULT_ORACLE_STATE_DIR = "/tmp/pi-oracle-state";
 const ORACLE_STATE_DIR = process.env.PI_ORACLE_STATE_DIR?.trim() || DEFAULT_ORACLE_STATE_DIR;
 const STALE_STAGING_PROFILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
-const AGENT_BROWSER_BIN = [process.env.AGENT_BROWSER_PATH, "/opt/homebrew/bin/agent-browser", "/usr/local/bin/agent-browser"].find(
+const AGENT_BROWSER_BIN = [process.env.AGENT_BROWSER_PATH, "/opt/homebrew/bin/agent-browser", "/usr/local/bin/agent-browser", "/usr/bin/agent-browser"].find(
   (candidate) => typeof candidate === "string" && candidate && existsSync(candidate),
 ) || "agent-browser";
 
@@ -160,6 +164,11 @@ function spawnCommand(command, args, options = {}) {
     }
     if (options.input) child.stdin.end(options.input);
     else child.stdin.end();
+    child.stdin.on("error", (error) => {
+      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
+      if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") return;
+      stderr += error instanceof Error ? `\n${error.message}` : `\n${String(error)}`;
+    });
     child.stdout.on("data", (data) => {
       stdout += String(data);
     });
@@ -266,7 +275,7 @@ async function createProfilePlan(profileDir) {
   if (targetDir === "/" || targetDir === homedir()) {
     throw new Error(`Oracle profileDir is unsafe: ${targetDir}`);
   }
-  if (targetDir === REAL_CHROME_USER_DATA_DIR || targetDir.startsWith(`${REAL_CHROME_USER_DATA_DIR}/`)) {
+  if (REAL_CHROME_USER_DATA_DIR && (targetDir === REAL_CHROME_USER_DATA_DIR || targetDir.startsWith(`${REAL_CHROME_USER_DATA_DIR}/`))) {
     throw new Error(`Oracle profileDir must not point into the real Chrome user-data directory: ${targetDir}`);
   }
 
@@ -468,16 +477,39 @@ function cookieSourceLabel() {
     : `Chrome profile ${config.auth.chromeProfile}`;
 }
 
+function markCookieImportUnavailable(error) {
+  if (error && typeof error === "object") {
+    try {
+      error.cookieImportUnavailable = true;
+    } catch {
+      // ignore non-extensible error objects; fallback marker is best-effort
+    }
+    return error;
+  }
+  const wrapped = new Error(String(error));
+  wrapped.cookieImportUnavailable = true;
+  return wrapped;
+}
 async function readSourceCookies() {
   await log(`Reading ChatGPT cookies from ${cookieSourceLabel()}`);
-  const { cookies, warnings } = await getCookies({
-    url: config.browser.chatUrl,
-    origins: cookieOrigins(),
-    browsers: ["chrome"],
-    mode: "merge",
-    chromeProfile: cookieSource(),
-    timeoutMs: 5_000,
-  });
+  let cookies = [];
+  let warnings = [];
+  try {
+    ({ cookies, warnings } = await getCookies({
+      url: config.browser.chatUrl,
+      origins: cookieOrigins(),
+      browsers: ["chrome"],
+      mode: "merge",
+      chromeProfile: cookieSource(),
+      timeoutMs: 5_000,
+    }));
+  } catch (error) {
+    throw markCookieImportUnavailable(
+      new Error(
+        `Failed to import ChatGPT cookies from ${cookieSourceLabel()}: ${error instanceof Error ? error.message : String(error)}. ${authConfigRemediation()}`,
+),
+    );
+  }
 
   if (warnings.length) {
     await log(`sweet-cookie warnings: ${warnings.join(" | ")}`);
@@ -500,8 +532,10 @@ async function readSourceCookies() {
   await log(`Cookie presence: sessionToken=${hasSessionToken} account=${hasAccountCookie}`);
 
   if (!hasSessionToken) {
-    throw new Error(
-      `No ChatGPT session-token cookies were found in ${cookieSourceLabel()}. Make sure ChatGPT is logged into that Chrome profile. ${authConfigRemediation()}`,
+    throw markCookieImportUnavailable(
+      new Error(
+        `No ChatGPT session-token cookies were found in ${cookieSourceLabel()}. Make sure ChatGPT is logged into that Chrome profile. ${authConfigRemediation()}`,
+),
     );
   }
 
@@ -711,7 +745,11 @@ function preserveBrowserError(message) {
   return error;
 }
 
-async function waitForImportedAuthReady() {
+function isCookieImportUnavailable(error) {
+  return Boolean(error && typeof error === "object" && error.cookieImportUnavailable === true);
+}
+
+async function waitForAuthReady(mode) {
   const startedAt = Date.now();
   const timeoutAt = startedAt + config.auth.bootstrapTimeoutMs;
   let retriedOutage = false;
@@ -727,8 +765,8 @@ async function waitForImportedAuthReady() {
     await writeFile(BODY_PATH, `${body}\n`, { mode: 0o600 }).catch(() => undefined);
     const classification = classifyChatPage({ url, snapshot, body, probe });
     await log(
-      `poll ${iteration}: url=${JSON.stringify(url)} probe=${JSON.stringify(probe)} classification=${classification.state} hasComposer=${snapshot.includes(`textbox \"${CHATGPT_LABELS.composer}\"`)} hasAddFiles=${snapshot.includes(`button \"${CHATGPT_LABELS.addFiles}\"`)}`,
-    );
+      `poll ${iteration}: mode=${mode} url=${JSON.stringify(url)} probe=${JSON.stringify(probe)} classification=${classification.state} hasComposer=${snapshot.includes(`textbox \"${CHATGPT_LABELS.composer}\"`)} hasAddFiles=${snapshot.includes(`button \"${CHATGPT_LABELS.addFiles}\"`)}`,
+);
     if (classification.state === "authenticated_and_ready") return classification;
     if (classification.state === "auth_transitioning") {
       const elapsedMs = Date.now() - startedAt;
@@ -756,8 +794,8 @@ async function waitForImportedAuthReady() {
         continue;
       }
       if (elapsedMs >= 20_000) {
-        await captureDiagnostics("auth-transition-timeout");
-        throw new Error(`ChatGPT accepted the session cookies but never left the public-looking homepage. Inspect ${LOG_PATH}.`);
+        await captureDiagnostics(mode === "manual" ? "manual-auth-transition-timeout" : "auth-transition-timeout");
+        throw new Error(`ChatGPT accepted auth but never left the public-looking homepage. Inspect ${LOG_PATH}.`);
       }
       await sleep(config.auth.pollMs);
       continue;
@@ -770,19 +808,62 @@ async function waitForImportedAuthReady() {
       continue;
     }
     if (classification.state === "challenge_blocking") {
-      await captureDiagnostics("challenge");
+      await captureDiagnostics(mode === "manual" ? "manual-challenge" : "challenge");
+      if (mode === "manual") {
+        await log("Manual login is on a challenge page; waiting for the user to finish it in the isolated oracle auth browser");
+        await sleep(config.auth.pollMs);
+        continue;
+      }
       throw preserveBrowserError(classification.message);
     }
     if (classification.state === "login_required") {
+      if (mode === "manual") {
+        if (iteration === 1) {
+          await log("Waiting for manual login in the isolated oracle auth browser");
+        }
+        await sleep(config.auth.pollMs);
+        continue;
+      }
       await captureDiagnostics("login-required");
       throw new Error(`${classification.message} ${authConfigRemediation()}`);
     }
     await sleep(config.auth.pollMs);
   }
-  await captureDiagnostics("timeout");
+  await captureDiagnostics(mode === "manual" ? "manual-login-timeout" : "timeout");
+  if (mode === "manual") {
+    throw new Error(`Timed out waiting for manual login in the isolated oracle auth browser. Logs: ${LOG_PATH}`);
+  }
   throw new Error(`Timed out verifying synced ChatGPT cookies in the isolated oracle profile. Logs: ${LOG_PATH}`);
 }
 
+async function waitForImportedAuthReady() {
+  return waitForAuthReady("imported");
+}
+
+async function waitForManualAuthReady() {
+  return waitForAuthReady("manual");
+}
+
+async function attemptImportedAuthBootstrap(profilePlan) {
+  const cookies = await readSourceCookies();
+  await prepareStagedProfile(profilePlan);
+  await launchTargetBrowser();
+  const appliedCount = await seedCookiesIntoTarget(cookies);
+  await log(`Cookie seeding complete: applied=${appliedCount}`);
+  await openUrl(config.browser.chatUrl, config.browser.chatUrl);
+  const classification = await waitForImportedAuthReady();
+  return { appliedCount, classification, usedManualLogin: false };
+}
+
+async function attemptManualLoginBootstrap(profilePlan) {
+  await log("Starting manual login fallback in the isolated oracle auth browser");
+  await prepareStagedProfile(profilePlan);
+  await launchTargetBrowser();
+  await openUrl(config.browser.authUrl, config.browser.authUrl);
+  const classification = await waitForManualAuthReady();
+  return { appliedCount: 0, classification, usedManualLogin: true };
+}
+
 async function run() {
   await initLog();
   await withLock(ORACLE_STATE_DIR, "auth", "global", { processPid: process.pid, action: "oracle-auth" }, async () => {
@@ -794,15 +875,18 @@ async function run() {
       await log(`Starting oracle auth bootstrap`);
       await log(
         `Config summary: session=${authSessionName()} seedProfileDir=${profilePlan.targetDir} stagingProfileDir=${profilePlan.stagingDir} executable=${config.browser.executablePath || "(default)"} source=${cookieSourceLabel()}`,
-      );
+);
       await log(authConfigSummary());
-      const cookies = await readSourceCookies();
-      await prepareStagedProfile(profilePlan);
-      await launchTargetBrowser();
-      const appliedCount = await seedCookiesIntoTarget(cookies);
-      await log(`Cookie seeding complete: applied=${appliedCount}`);
-      await openUrl(config.browser.chatUrl, config.browser.chatUrl);
-      const classification = await waitForImportedAuthReady();
+      let bootstrapResult;
+      try {
+        bootstrapResult = await attemptImportedAuthBootstrap(profilePlan);
+      } catch (error) {
+        if (!isCookieImportUnavailable(error)) throw error;
+        await log(`Imported auth bootstrap attempt failed: ${error instanceof Error ? error.message : String(error)}`);
+        await closeTargetBrowser().catch(() => undefined);
+        bootstrapResult = await attemptManualLoginBootstrap(profilePlan);
+      }
+      const { appliedCount, classification, usedManualLogin } = bootstrapResult;
       await log(`Auth bootstrap success: ${classification.message}`);
       await closeTargetBrowser();
       await commitStagedProfile(profilePlan);
@@ -810,7 +894,9 @@ async function run() {
       await writeFile(join(profilePlan.targetDir, ".oracle-seed-generation"), `${generation}\n`, { encoding: "utf8", mode: 0o600 });
       committedProfile = true;
       process.stdout.write(
-        `${classification.message} Synced ${appliedCount} cookies into ${profilePlan.targetDir}. Diagnostics: ${DIAGNOSTICS_DIR}`,
+        usedManualLogin
+          ? `${classification.message} Saved manual-login auth seed profile in ${profilePlan.targetDir}. Diagnostics: ${DIAGNOSTICS_DIR}`
+          : `${classification.message} Synced ${appliedCount} cookies into ${profilePlan.targetDir}. Diagnostics: ${DIAGNOSTICS_DIR}`,
       );
     } catch (error) {
       shouldPreserveBrowser = Boolean(error && typeof error === "object" && error.preserveBrowser === true);
@@ -828,7 +914,7 @@ async function run() {
 
 run().catch((error) => {
   process.stderr.write(
-    `${error instanceof Error ? error.message : String(error)}\nSee ${LOG_PATH} and diagnostics in ${DIAGNOSTICS_DIR || "(oracle-auth diagnostics dir unavailable)"}\n${authConfigSummary()}\nIf needed, ensure the configured real Chrome profile is already logged into ChatGPT and grant macOS Keychain access when prompted.`,
+    `${error instanceof Error ? error.message : String(error)}\nSee ${LOG_PATH} and diagnostics in ${DIAGNOSTICS_DIR || "(oracle-auth diagnostics dir unavailable)"}\n${authConfigSummary()}\nIf cookie import is unavailable, rerun /oracle-auth and complete login in the isolated oracle auth browser when the manual fallback opens.`,
   );
   process.exit(1);
 });
diff --git a/extensions/oracle/worker/run-job.mjs b/extensions/oracle/worker/run-job.mjs
index a6ac7c3..57eee05 100644
--- a/extensions/oracle/worker/run-job.mjs
+++ b/extensions/oracle/worker/run-job.mjs
@@ -69,7 +69,7 @@ const MODEL_CONFIGURATION_SETTLE_TIMEOUT_MS = 20_000;
 const MODEL_CONFIGURATION_SETTLE_POLL_MS = 250;
 const MODEL_CONFIGURATION_CLOSE_RETRY_MS = 1_000;
 const POST_SEND_SETTLE_MS = 15_000;
-const AGENT_BROWSER_BIN = [process.env.AGENT_BROWSER_PATH, "/opt/homebrew/bin/agent-browser", "/usr/local/bin/agent-browser"].find(
+const AGENT_BROWSER_BIN = [process.env.AGENT_BROWSER_PATH, "/opt/homebrew/bin/agent-browser", "/usr/local/bin/agent-browser", "/usr/bin/agent-browser"].find(
   (candidate) => typeof candidate === "string" && candidate && existsSync(candidate),
 ) || "agent-browser";
 
diff --git a/package.json b/package.json
index e8a3ee9..5119f37 100644
--- a/package.json
+++ b/package.json
@@ -16,12 +16,12 @@
   ],
   "repository": {
     "type": "git",
-    "url": "git+https://github.com/fitchmultz/pi-oracle.git"
+    "url": "git+https://github.com/huynguyendinhquang/pi-oracle.git"
   },
   "bugs": {
-    "url": "https://github.com/fitchmultz/pi-oracle/issues"
+    "url": "https://github.com/huynguyendinhquang/pi-oracle/issues"
   },
-  "homepage": "https://github.com/fitchmultz/pi-oracle#readme",
+  "homepage": "https://github.com/huynguyendinhquang/pi-oracle#readme",
   "publishConfig": {
     "access": "public"
   },
@@ -72,8 +72,10 @@
   },
   "engines": {
     "node": ">=22"
-  },
+  }
+,
   "os": [
-    "darwin"
+    "darwin",
+    "linux"
   ]
 }
diff --git a/scripts/oracle-sanity.ts b/scripts/oracle-sanity.ts
index 6478fb7..00a6b86 100644
--- a/scripts/oracle-sanity.ts
+++ b/scripts/oracle-sanity.ts
@@ -815,6 +815,7 @@ async function testAuthBootstrapReportsEffectiveConfigPaths(config: OracleConfig
     },
     auth: {
       ...config.auth,
+      bootstrapTimeoutMs: 500,
       chromeCookiePath: join(fixtureDir, "missing-cookies.sqlite"),
     },
   };
@@ -3120,7 +3121,7 @@ async function testOraclePromptTemplateCutover(): Promise<void> {
   assert(pkg.files?.includes("prompts"), "package.json files should include prompts");
   assert(pkg.pi?.prompts?.includes("./prompts"), "package.json pi.prompts should include ./prompts");
   assert(pkg.engines?.node === ">=22", "package.json should advertise the actual Node.js support floor");
-  assert(pkg.os?.includes("darwin"), "package.json should declare macOS-only support");
+  assert(Array.isArray(pkg.os) && pkg.os.includes("darwin") && pkg.os.includes("linux"), "package.json should declare both macOS and Linux support");
   assert(pkg.scripts?.test === "npm run verify:oracle", "package.json should expose the local verification gate through npm test");
   assert(pkg.scripts?.["typecheck:worker-helpers"] === "tsc --noEmit -p tsconfig.worker-helpers.json", "package.json should statically typecheck extracted worker/auth helpers");
   assert(String(pkg.scripts?.["verify:oracle"] || "").includes("typecheck:worker-helpers"), "full local verification should include worker/auth helper typechecking");
@@ -3191,6 +3192,8 @@ async function testResponseTimeoutGuard(): Promise<void> {
   assert(authBootstrapSource.includes("timed out after"), "auth bootstrap subprocess wrapper should report timeout failures clearly");
   assert(authBootstrapSource.includes("Effective oracle auth config:"), "auth bootstrap failures should report the effective auth config path for the active agent dir");
   assert(!authBootstrapSource.includes("~/.pi/agent/extensions/oracle.json"), "auth bootstrap should not hardcode the default global config path in user-facing remediation guidance");
+  assert(!authBootstrapSource.includes("Keychain"), "auth bootstrap should not mention macOS Keychain in user-facing guidance");
+  assert(authBootstrapSource.toLowerCase().includes("manual") && authBootstrapSource.toLowerCase().includes("login"), "auth bootstrap should include a manual-login fallback path");
   assert(stateLocksSource.includes("state-coordination-helpers.mjs"), "worker state-lock wrappers should delegate to the shared state coordination helper module");
   assert(sharedStateSource.includes("ORACLE_METADATA_WRITE_GRACE_MS = 1_000"), "shared worker state-lock helper should use a bounded grace before reclaiming metadata-less state dirs");
   assert(sharedStateSource.includes("ORACLE_TMP_STATE_DIR_GRACE_MS = 60_000"), "shared worker state-lock helper should use a longer grace for in-flight .tmp-* dirs under concurrent sweep");
@@ -4425,6 +4428,12 @@ async function testPollerHostSafety(): Promise<void> {
 async function main() {
   await ensureNoActiveJobs();
   assert(DEFAULT_CONFIG.browser.maxConcurrentJobs === 2, "default oracle concurrency should be 2");
+  if (process.platform === "linux") {
+    assert(DEFAULT_CONFIG.browser.cloneStrategy === "copy", "Linux oracle default clone strategy should use copy");
+  }
+  if (process.platform === "darwin") {
+    assert(DEFAULT_CONFIG.browser.cloneStrategy === "apfs-clone", "macOS oracle default clone strategy should keep apfs-clone");
+  }
   const config: OracleConfig = {
     ...DEFAULT_CONFIG,
     browser: { ...DEFAULT_CONFIG.browser, maxConcurrentJobs: 1 },
```
