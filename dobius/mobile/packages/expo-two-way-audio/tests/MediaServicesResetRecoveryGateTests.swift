@main
struct MediaServicesResetRecoveryGateTests {
    static func main() {
        var gate = MediaServicesResetRecoveryGate()
        precondition(gate.permitsAutomaticStart)

        gate.mediaServicesWereReset()
        precondition(!gate.permitsAutomaticStart)

        gate.finishUserInitiatedRecovery(succeeded: false)
        precondition(!gate.permitsAutomaticStart)

        gate.finishUserInitiatedRecovery(succeeded: true)
        precondition(gate.permitsAutomaticStart)

        print("PASS: media reset requires successful user-initiated recovery")
    }
}
