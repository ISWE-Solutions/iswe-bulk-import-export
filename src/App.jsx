import React from 'react'
import { DataProvider } from '@dhis2/app-runtime'
import { ImportWizard } from './components/ImportWizard'

const App = () => (
    <DataProvider>
        <ImportWizard />
    </DataProvider>
)

export default App
