import {LoginForm} from '@/components/login-form';

export default async function LoginPage({searchParams}: {searchParams: Promise<{error?: string | string[]}>}) {
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  return <LoginForm initialError={error} />;
}
