import type {Metadata} from 'next';
import {PictureIntake} from '@/components/projects/picture-intake';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.pictures')};
}

// Choose or photograph several views of one subject, put them in order and keep them privately (Story 2.2: C-03). Nothing is read from the database here and
// nothing exists until Save: the pictures go from the browser to the file gateway, and the first Save creates the Project. The page only has to know who is asking.
export default async function NewPicturesPage() {
  await requireActiveAccount();
  return <PictureIntake/>;
}
