"use client";

export interface LegalNameValue {
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  no_middle_name: boolean;
}

interface LegalNameFieldsProps {
  value: LegalNameValue;
  onChange: (value: LegalNameValue) => void;
  onBlur: () => void;
}

const inputClass =
  "w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]";

export default function LegalNameFields({
  value,
  onChange,
  onBlur,
}: LegalNameFieldsProps) {
  const update = (changes: Partial<LegalNameValue>) =>
    onChange({ ...value, ...changes });

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold text-[#0D1B3E]">
        Complete legal name <span className="text-[#C9A84C]">*</span>
      </legend>
      <p className="text-[11px] text-gray-400">
        Enter the name exactly as shown on a valid ID. Middle name is required
        unless the member legally has none.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">First name *</span>
          <input
            value={value.first_name}
            onChange={(event) => update({ first_name: event.target.value })}
            onBlur={onBlur}
            placeholder="Juan"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">
            Middle name {!value.no_middle_name && "*"}
          </span>
          <input
            value={value.middle_name}
            onChange={(event) => update({ middle_name: event.target.value })}
            onBlur={onBlur}
            disabled={value.no_middle_name}
            placeholder={
              value.no_middle_name ? "No legal middle name" : "Santos"
            }
            className={`${inputClass} disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Last name *</span>
          <input
            value={value.last_name}
            onChange={(event) => update({ last_name: event.target.value })}
            onBlur={onBlur}
            placeholder="Cruz"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">
            Suffix (optional)
          </span>
          <select
            value={value.suffix}
            onChange={(event) => update({ suffix: event.target.value })}
            onBlur={onBlur}
            className={inputClass}
          >
            <option value="">None</option>
            <option value="Jr.">Jr.</option>
            <option value="Sr.">Sr.</option>
            <option value="II">II</option>
            <option value="III">III</option>
            <option value="IV">IV</option>
            <option value="V">V</option>
          </select>
        </label>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={value.no_middle_name}
          onChange={(event) =>
            update({
              no_middle_name: event.target.checked,
              middle_name: event.target.checked ? "" : value.middle_name,
            })
          }
        />
        This member legally has no middle name
      </label>
    </fieldset>
  );
}
