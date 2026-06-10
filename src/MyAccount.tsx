import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Avatar } from "./shared";

// Profile screen: change your display name and profile picture. The name
// propagates to every game you're in; the picture uploads to Convex storage.
export default function MyAccount() {
  const me = useQuery(api.account.me);
  const generateUploadUrl = useMutation(api.account.generateUploadUrl);
  const updateProfile = useMutation(api.account.updateProfile);
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Seed the name field once the account loads.
  useEffect(() => {
    if (me) setName(me.name);
  }, [me?.name]);

  async function handleSaveName() {
    const clean = name.trim();
    if (!clean) return setErr("Pop your name in first.");
    setSavingName(true);
    setErr("");
    setMsg("");
    try {
      await updateProfile({ name: clean });
      setMsg("Name updated.");
    } catch (e: any) {
      setErr(e.message ?? "Could not update your name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/"))
      return setErr("Choose an image file.");
    if (file.size > 5 * 1024 * 1024)
      return setErr("Image must be under 5 MB.");

    setUploading(true);
    setErr("");
    setMsg("");
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: string };
      await updateProfile({ imageId: storageId as Id<"_storage"> });
      setMsg("Picture updated.");
    } catch (e: any) {
      setErr(e.message ?? "Could not upload your picture.");
    } finally {
      setUploading(false);
    }
  }

  const nameChanged = !!me && name.trim() !== me.name;

  return (
    <>
      <header className="wrap">
        <div className="kicker">Your profile · 2026</div>
        <h1>
          My <em>account</em>
        </h1>
        <p className="sub">
          Set how you show up in every draw - your name and a profile picture.
        </p>
      </header>

      <div className="center-stage">
        {me === undefined ? (
          <div className="panel">
            <p className="hint">Loading…</p>
          </div>
        ) : me === null ? (
          <div className="panel">
            <p className="hint">Sign in to manage your account.</p>
          </div>
        ) : (
          <div className="panel">
            <div className="account-pic">
              <Avatar src={me.imageUrl} name={me.name} size={96} />
              <div>
                <button
                  className="btn ghost"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? "Uploading…" : "Change picture"}
                </button>
                <p className="hint" style={{ margin: "6px 0 0" }}>
                  JPG or PNG, up to 5 MB.
                </p>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={handlePickFile}
              />
            </div>

            <div className="field">
              <label>Your name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Luc"
                maxLength={18}
              />
            </div>
            <button
              className="btn big"
              disabled={savingName || !nameChanged}
              onClick={handleSaveName}
            >
              {savingName ? "Saving…" : "Save name"}
            </button>

            {me.email && (
              <p className="hint" style={{ marginTop: 14 }}>
                Signed in as {me.email}
              </p>
            )}

            {msg && <div className="ok">{msg}</div>}
            {err && <div className="err">{err}</div>}
          </div>
        )}
      </div>
    </>
  );
}
