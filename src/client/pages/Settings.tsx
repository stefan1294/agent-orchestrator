import { ChevronDown, ChevronRight, Info, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchSettings, updateSettings } from '../hooks/useApi';
import type { SettingDefinition } from '../types';

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingDefinition[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchSettings();
        setSettings(data);
        const vals: Record<string, string> = {};
        for (const s of data) {
          vals[s.key] = s.value;
        }
        setValues(vals);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  };

  const handleReset = (setting: SettingDefinition) => {
    handleChange(setting.key, setting.defaultValue);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const updated = await updateSettings(values);
      setSettings(updated);
      const vals: Record<string, string> = {};
      for (const s of updated) {
        vals[s.key] = s.value;
      }
      setValues(vals);
      setSuccess('Settings saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  // Group settings by group name, preserving order
  const groupOrder: string[] = [];
  const groups: Record<string, SettingDefinition[]> = {};
  for (const s of settings) {
    if (!groups[s.group]) {
      groups[s.group] = [];
      groupOrder.push(s.group);
    }
    groups[s.group].push(s);
  }

  const isModified = (setting: SettingDefinition) => {
    return values[setting.key] !== setting.defaultValue;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950 text-red-200 rounded-lg border border-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-950 text-green-200 rounded-lg border border-green-800">
          {success}
        </div>
      )}

      <p className="text-gray-400 text-sm">
        Configure orchestrator behavior. All settings are saved to{' '}
        <code className="text-gray-300">orchestrator.config.json</code> in the project directory.
      </p>

      {groupOrder.map((groupName) => {
        const groupSettings = groups[groupName];
        const isCollapsed = collapsedGroups.has(groupName);

        return (
          <div key={groupName} className="border border-gray-800 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleGroup(groupName)}
              className="w-full bg-gray-900 px-4 py-3 border-b border-gray-800 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
                <h2 className="text-lg font-semibold text-white">{groupName}</h2>
                <span className="text-gray-500 text-sm">({groupSettings.length})</span>
              </div>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-gray-800">
                {groupSettings.map((setting) => (
                  <SettingRow
                    key={setting.key}
                    setting={setting}
                    value={values[setting.key] ?? setting.defaultValue}
                    onChange={(val) => handleChange(setting.key, val)}
                    onReset={() => handleReset(setting)}
                    modified={isModified(setting)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Setting Row Component ─────────────────────────────────────

function SettingRow({
  setting,
  value,
  onChange,
  onReset,
  modified,
}: {
  setting: SettingDefinition;
  value: string;
  onChange: (val: string) => void;
  onReset: () => void;
  modified: boolean;
}) {
  return (
    <div className="px-4 py-4 space-y-2">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-gray-200 font-medium">{setting.label}</label>
            {modified && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-950 text-amber-300 border border-amber-800">
                MODIFIED
              </span>
            )}
            {modified && (
              <button
                onClick={onReset}
                className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
                title="Reset to default"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {setting.description && (
            <p className="text-gray-500 text-xs mt-1">{setting.description}</p>
          )}
          {setting.recommendation && (
            <div className="flex items-start gap-1.5 mt-1.5">
              <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-blue-400/70 text-xs">{setting.recommendation}</p>
            </div>
          )}
        </div>
        <div className="w-80 flex-shrink-0">
          <SettingInput setting={setting} value={value} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

// ─── Setting Input Component ───────────────────────────────────

function SettingInput({
  setting,
  value,
  onChange,
}: {
  setting: SettingDefinition;
  value: string;
  onChange: (val: string) => void;
}) {
  if (setting.type === 'select' && setting.options) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500"
      >
        {setting.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (setting.type === 'boolean') {
    return (
      <button
        onClick={() => onChange(value === '1' ? '0' : '1')}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
          value === '1' ? 'bg-blue-600' : 'bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            value === '1' ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    );
  }

  if (setting.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder={setting.defaultValue || 'Leave empty for built-in default...'}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500 text-sm font-mono resize-y"
      />
    );
  }

  if (setting.type === 'tags') {
    return <TagsInput value={value} onChange={onChange} />;
  }

  if (setting.type === 'json') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500 text-xs font-mono resize-y"
      />
    );
  }

  return (
    <input
      type={setting.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500"
    />
  );
}

// ─── Tags Input (comma-separated pills) ────────────────────────

function TagsInput({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const [inputValue, setInputValue] = useState('');
  const tags = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed].join(','));
    }
    setInputValue('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag).join(','));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 flex flex-wrap gap-1.5 items-center focus-within:border-blue-500">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-700 text-gray-200 text-sm"
        >
          {tag}
          <button
            onClick={() => removeTag(tag)}
            className="text-gray-400 hover:text-red-400 transition-colors"
          >
            &times;
          </button>
        </span>
      ))}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) addTag(inputValue);
        }}
        placeholder={tags.length === 0 ? 'Type and press Enter...' : ''}
        className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-gray-200 text-sm py-0.5"
      />
    </div>
  );
}
