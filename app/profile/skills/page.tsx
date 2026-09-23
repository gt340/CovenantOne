"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export default function SkillsPage() {
  const [skills, setSkills] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/profile/skills", { credentials: "include" });
    if (res.ok) {
      const d = await res.json();
      setSkills(d.skills ?? []);
      setServices(d.servicesOffered ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(nextSkills: string[], nextServices: string[]) {
    setSaving(true);
    await fetch("/api/profile/skills", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills: nextSkills, servicesOffered: nextServices }),
    });
    setSaving(false);
  }

  function addSkill() {
    if (!skillInput.trim()) return;
    const next = [...skills, skillInput.trim()];
    setSkills(next);
    setSkillInput("");
    save(next, services);
  }
  function removeSkill(s: string) {
    const next = skills.filter((x) => x !== s);
    setSkills(next);
    save(next, services);
  }
  function addService() {
    if (!serviceInput.trim()) return;
    const next = [...services, serviceInput.trim()];
    setServices(next);
    setServiceInput("");
    save(skills, next);
  }
  function removeService(s: string) {
    const next = services.filter((x) => x !== s);
    setServices(next);
    save(skills, next);
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/profile" className="text-sm text-blue-600 mb-3 inline-block">← Back to Profile</Link>
      <h1 className="text-2xl font-semibold mb-1">Skills & Services</h1>
      <p className="text-sm text-gray-500 mb-6">Shown to other members on the professional side of the platform.</p>

      <h2 className="text-sm font-medium text-gray-500 mb-2">Skills</h2>
      <div className="flex gap-2 flex-wrap mb-2">
        {skills.map((s) => (
          <span key={s} className="text-xs px-2 py-1 rounded-full border flex items-center gap-1">
            {s}
            <button onClick={() => removeSkill(s)} className="text-gray-400">×</button>
          </span>
        ))}
        {skills.length === 0 && <span className="text-xs text-gray-400">No skills added yet.</span>}
      </div>
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="e.g. Graphic Design"
          value={skillInput}
          onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSkill()}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={addSkill} className="px-3 py-2 text-sm rounded-md border">Add</button>
      </div>

      <h2 className="text-sm font-medium text-gray-500 mb-2">Services Offered</h2>
      <div className="flex gap-2 flex-wrap mb-2">
        {services.map((s) => (
          <span key={s} className="text-xs px-2 py-1 rounded-full border flex items-center gap-1">
            {s}
            <button onClick={() => removeService(s)} className="text-gray-400">×</button>
          </span>
        ))}
        {services.length === 0 && <span className="text-xs text-gray-400">No services added yet.</span>}
      </div>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="e.g. Freelance Bookkeeping"
          value={serviceInput}
          onChange={(e) => setServiceInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addService()}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={addService} className="px-3 py-2 text-sm rounded-md border">Add</button>
      </div>
      {saving && <div className="text-xs text-gray-400">Saving...</div>}
    </div>
  );
}
