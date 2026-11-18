// ДИЗАССЕМБЛЕР: показать реальные инструкции нашего образа.
//
// ЗАЧЕМ: метрика концентрации говорит «это код». Но надо посмотреть
// ГЛАЗАМИ: если дизассемблер выдаёт осмысленные последовательности,
// значит разбор удался. Если бы это был мусор — увидели бы случайные
// инструкции с бессмысленными операндами.
//
// Запуск:
//   analyzeHeadless <proj> <name> -process <file> -noanalysis \
//     -scriptPath <dir> -postScript ShowDisasm.java <offset> <count>

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;

public class ShowDisasm extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] scriptArgs = getScriptArgs();
        long startOff = scriptArgs.length > 0 ? Long.decode(scriptArgs[0]) : 0;
        int count = scriptArgs.length > 1 ? Integer.parseInt(scriptArgs[1]) : 60;

        println("=== DISASM: " + currentProgram.getName() + " ===");

        Address start = currentProgram.getMinAddress().add(startOff);
        println("начало: " + start.toString() + " (offset 0x" + Long.toHexString(startOff) + ")");

        Address cur = start;
        int shown = 0;
        int attempts = 0;

        while (shown < count && attempts < count * 6) {
            attempts++;
            Instruction ins = getInstructionAt(cur);
            if (ins == null) {
                boolean ok = false;
                try {
                    ok = disassemble(cur);
                } catch (Exception e) {
                    ok = false;
                }
                if (!ok) {
                    cur = cur.add(2);
                    continue;
                }
                ins = getInstructionAt(cur);
            }
            if (ins == null) {
                cur = cur.add(2);
                continue;
            }

            println("  " + ins.getAddress().toString() + "   " + ins.toString());

            cur = ins.getMaxAddress().add(1);
            shown++;
        }

        println("показано: " + shown);
        println("=== END ===");
    }
}
