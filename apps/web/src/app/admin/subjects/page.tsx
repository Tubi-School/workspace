'use client';

import { NamedEntityManager } from '@/components/admin/named-entity-manager';
import { subjectsApi } from '@/lib/endpoints';

export default function SubjectsPage() {
  return (
    <NamedEntityManager
      title="Subjects"
      description="Curricular subject categories, e.g. Mathematics."
      fetchAll={subjectsApi.list}
      create={subjectsApi.create}
      update={subjectsApi.update}
      remove={subjectsApi.remove}
    />
  );
}
