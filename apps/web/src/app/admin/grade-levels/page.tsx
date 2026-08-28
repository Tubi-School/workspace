'use client';

import { NamedEntityManager } from '@/components/admin/named-entity-manager';
import { gradeLevelsApi } from '@/lib/endpoints';

export default function GradeLevelsPage() {
  return (
    <NamedEntityManager
      title="Grade Levels"
      description="The curricular grade taxonomy used across every course."
      fetchAll={gradeLevelsApi.list}
      create={gradeLevelsApi.create}
      update={gradeLevelsApi.update}
      remove={gradeLevelsApi.remove}
    />
  );
}
