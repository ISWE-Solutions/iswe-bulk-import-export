import React from 'react'
import { DataProvider } from '@dhis2/app-runtime'
import { ImportWizard } from './components/ImportWizard'

// Note: the DHIS2 app shell already renders a HeaderBar automatically, so we do
// not mount one here — doing so produced a duplicated header.
const App = () => (
    <DataProvider>
        <ImportWizard />
    </DataProvider>
)

export default App
