struct MediaServicesResetRecoveryGate {
    private(set) var requiresUserInitiatedRecovery = false

    var permitsAutomaticStart: Bool {
        !requiresUserInitiatedRecovery
    }

    mutating func mediaServicesWereReset() {
        requiresUserInitiatedRecovery = true
    }

    mutating func finishUserInitiatedRecovery(succeeded: Bool) {
        if succeeded {
            requiresUserInitiatedRecovery = false
        }
    }
}
