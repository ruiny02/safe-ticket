const USER_PROFILE_STORAGE_KEY = "safeTicketUserProfile";
const USER_PROFILE_UPDATED_MESSAGE_TYPE = "safe-ticket-user-profile-updated";
const USER_PROFILE_SYNC_MESSAGE_TYPE = "safe-ticket-user-profile-sync";
const EXPERIENCE_LEVELS = new Set(["beginner", "intermediate", "advanced"]);

function normalizeUserProfile(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawAge = value.age;
  const age = typeof rawAge === "number" && Number.isFinite(rawAge) && rawAge >= 0 && rawAge <= 120 ? rawAge : null;
  const tradeExperienceLevel = EXPERIENCE_LEVELS.has(value.trade_experience_level)
    ? value.trade_experience_level
    : null;

  if (age === null && tradeExperienceLevel === null) {
    return null;
  }

  return {
    age,
    trade_experience_level: tradeExperienceLevel,
  };
}

function readReportProfile() {
  try {
    return normalizeUserProfile(JSON.parse(window.localStorage.getItem(USER_PROFILE_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

function writeReportProfile(profile) {
  window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  window.postMessage(
    {
      type: USER_PROFILE_SYNC_MESSAGE_TYPE,
      userProfile: profile,
    },
    window.location.origin,
  );
}

async function writeExtensionProfile(profile) {
  const storageApi = globalThis.chrome?.storage?.local;
  if (!storageApi || !profile) {
    return;
  }

  await storageApi.set({
    [USER_PROFILE_STORAGE_KEY]: profile,
  });
}

async function syncInitialProfile() {
  const storageApi = globalThis.chrome?.storage?.local;
  if (!storageApi) {
    return;
  }

  const [stored, reportProfile] = await Promise.all([storageApi.get(USER_PROFILE_STORAGE_KEY), readReportProfile()]);
  const extensionProfile = normalizeUserProfile(stored[USER_PROFILE_STORAGE_KEY]);

  if (extensionProfile) {
    writeReportProfile(extensionProfile);
    return;
  }

  if (reportProfile) {
    await writeExtensionProfile(reportProfile);
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  const data = event.data;
  if (!data || data.type !== USER_PROFILE_UPDATED_MESSAGE_TYPE) {
    return;
  }

  void writeExtensionProfile(normalizeUserProfile(data.userProfile));
});

void syncInitialProfile();
