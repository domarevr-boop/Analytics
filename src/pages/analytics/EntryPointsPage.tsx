import { isV5EntryPointsBackendEnabled } from '../../features/entryPoints/entryPointsData';
import EntryPointsLocalPage from './EntryPointsLocalPage';
import EntryPointsServerPage from './EntryPointsServerPage';

export default function EntryPointsPage() {
  return isV5EntryPointsBackendEnabled ? <EntryPointsServerPage /> : <EntryPointsLocalPage />;
}
