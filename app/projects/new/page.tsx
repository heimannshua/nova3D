import type {Metadata} from 'next';
import {RequestIntake} from '@/components/projects/request-intake';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.newProject')};
}

// Describe a model in words, check what was understood, and confirm it (Story 2.1: C-02 and C-06, one narrow page for the whole flow).
// Nothing is read from the database here and nothing is stored until Confirm; the page only has to know who is asking.
export default async function NewProjectPage() {
  await requireActiveAccount();
  return <RequestIntake/>;
}
