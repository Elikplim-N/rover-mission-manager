import { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import type { Field } from '../types';

export default function Fields() {
  const [fields, setFields] = useState<Field[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    area: '',
    notes: ''
  });

  useEffect(() => {
    loadFields();
  }, []);

  async function loadFields() {
    const allFields = await db.fields.toArray();
    setFields(allFields);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const field: Field = {
      id: generateId(),
      name: formData.name,
      location: formData.location || undefined,
      area: formData.area ? parseFloat(formData.area) : undefined,
      notes: formData.notes || undefined,
      createdAt: new Date()
    };

    await db.fields.add(field);
    await loadFields();

    setFormData({ name: '', location: '', area: '', notes: '' });
    setShowForm(false);
  }

  async function deleteField(id: string) {
    if (!confirm('Delete this field?')) return;
    await db.fields.delete(id);
    await loadFields();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Field Management</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your planting fields
          </p>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Field'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">New Field</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Area (sq meters)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.area}
                onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
            >
              Create Field
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {fields.map((field) => (
          <div key={field.id} className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">{field.name}</h3>
              <button
                onClick={() => deleteField(field.id)}
                className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 text-sm"
              >
                Delete
              </button>
            </div>

            {field.location && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                <span className="font-medium">Location:</span> {field.location}
              </p>
            )}

            {field.area && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                <span className="font-medium">Area:</span> {field.area} m²
              </p>
            )}

            {field.notes && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                {field.notes}
              </p>
            )}
          </div>
        ))}

        {fields.length === 0 && !showForm && (
          <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
            No fields created yet
          </div>
        )}
      </div>
    </div>
  );
}
