'use client';

import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import {
  academicTermsApi,
  coursesApi,
  gradeLevelsApi,
  subjectsApi,
  teachersApi,
} from '@/lib/endpoints';

async function fetchFormOptions() {
  const [subjects, gradeLevels, academicTerms, teachers] = await Promise.all([
    subjectsApi.list(),
    gradeLevelsApi.list(),
    academicTermsApi.list(),
    teachersApi.list(),
  ]);
  return { subjects, gradeLevels, academicTerms, teachers };
}

export default function CoursesPage() {
  const courses = useFetch(coursesApi.list);
  const options = useFetch(fetchFormOptions);

  const [subjectId, setSubjectId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [academicTermId, setAcademicTermId] = useState('');
  const [primaryTeacherId, setPrimaryTeacherId] = useState('');
  const [title, setTitle] = useState('');

  const createAction = useAsyncAction(async () => {
    await coursesApi.create({
      subjectId,
      gradeLevelId,
      academicTermId,
      primaryTeacherId,
      title: title.trim(),
    });
    setTitle('');
    courses.refetch();
  });

  const refetchBoth = useCallback(() => {
    courses.refetch();
    options.refetch();
  }, [courses, options]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!subjectId || !gradeLevelId || !academicTermId || !primaryTeacherId || !title.trim())
      return;
    void createAction.run();
  }

  const formReady = options.data
    ? options.data.subjects.length > 0 &&
      options.data.gradeLevels.length > 0 &&
      options.data.academicTerms.length > 0 &&
      options.data.teachers.length > 0
    : false;

  return (
    <div>
      <PageHeader
        title="Courses"
        description="A taught unit for a term, linking subject, grade level and teacher."
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Add a course</h2>

        {options.isLoading && <LoadingState />}
        {options.error && <ErrorState message={options.error} onRetry={refetchBoth} />}

        {options.data && !formReady && (
          <EmptyState
            title="Set up prerequisites first"
            description="Add at least one subject, grade level, academic term, and teacher before creating a course."
          />
        )}

        {options.data && formReady && (
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Title">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <Field label="Subject">
              <Select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select a subject</option>
                {options.data.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Grade level">
              <Select
                value={gradeLevelId}
                onChange={(e) => setGradeLevelId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select a grade level</option>
                {options.data.gradeLevels.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Academic term">
              <Select
                value={academicTermId}
                onChange={(e) => setAcademicTermId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select a term</option>
                {options.data.academicTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Primary teacher">
              <Select
                value={primaryTeacherId}
                onChange={(e) => setPrimaryTeacherId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select a teacher</option>
                {options.data.teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createAction.isSubmitting}>
                {createAction.isSubmitting ? 'Adding…' : 'Add course'}
              </Button>
            </div>
          </form>
        )}
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {courses.isLoading && <LoadingState />}
      {courses.error && <ErrorState message={courses.error} onRetry={courses.refetch} />}
      {!courses.isLoading && !courses.error && courses.data && courses.data.length === 0 && (
        <EmptyState
          title="No courses yet"
          description="Add the first course using the form above."
        />
      )}
      {!courses.isLoading && !courses.error && courses.data && courses.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {courses.data.map((course) => (
            <li
              key={course.id}
              className="border-border bg-surface-raised rounded-lg border px-4 py-3"
            >
              <p className="text-foreground text-sm font-medium">{course.title}</p>
              <p className="text-muted-foreground text-sm">
                {course.subject.name} · {course.gradeLevel.name} · {course.academicTerm.name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
