import {NovaDashboard} from '@/components/nova-dashboard';
import {requireActiveAccount} from '@/lib/auth';
import {loadProjectList} from '@/lib/project-pages';

// Home (H-01): the three primary actions with the real count of Projects, the three most recently updated ones, and an honest empty
// state for an Account that has none. The Projects are the database's, for the Account and epoch of the verified access.
export default async function HomePage() {
  const access = await requireActiveAccount();
  const listing = await loadProjectList(access, 3);
  // A request the database no longer gives authority is not an empty workspace: it is shown as a list that could not be read, and
  // asking again lets the gate say where this person now belongs (Home cannot send itself Home).
  return <NovaDashboard view="home" listing={listing.state === 'listed' ? listing : {state: 'unreadable'}}/>;
}
