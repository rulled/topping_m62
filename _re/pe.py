import struct, sys, bisect

class PE:
    def __init__(self, path):
        self.path = path
        self.data = open(path,'rb').read()
        d = self.data
        e = struct.unpack_from('<I', d, 0x3C)[0]
        self.pe = e
        nsec = struct.unpack_from('<H', d, e+6)[0]
        optsz = struct.unpack_from('<H', d, e+20)[0]
        opt = e+24
        self.magic = struct.unpack_from('<H', d, opt)[0]
        self.imagebase = struct.unpack_from('<Q', d, opt+24)[0] if self.magic==0x20b else struct.unpack_from('<I', d, opt+28)[0]
        self.sections=[]
        so = opt+optsz
        for i in range(nsec):
            o = so+i*40
            name = d[o:o+8].rstrip(b'\0').decode('latin1')
            vs, va, rs, rp = struct.unpack_from('<IIII', d, o+8)
            self.sections.append(dict(name=name, va=va, vsize=vs, rawptr=rp, rawsize=rs))
        # exports
        self.exports = {}
        edir_rva = struct.unpack_from('<I', d, opt+112)[0]
        edir_sz  = struct.unpack_from('<I', d, opt+116)[0]
        if edir_rva:
            eo = self.rva2off(edir_rva)
            nfun, nnam, af, an, ao = struct.unpack_from('<IIIII', d, eo+20)
            for i in range(nnam):
                nrva = struct.unpack_from('<I', d, self.rva2off(an)+i*4)[0]
                name = self.cstr(self.rva2off(nrva))
                ordi = struct.unpack_from('<H', d, self.rva2off(ao)+i*2)[0]
                frva = struct.unpack_from('<I', d, self.rva2off(af)+ordi*4)[0]
                self.exports[name] = frva

    def rva2off(self, rva):
        for s in self.sections:
            if s['va'] <= rva < s['va'] + max(s['vsize'], s['rawsize']):
                if rva - s['va'] < s['rawsize']:
                    return s['rawptr'] + (rva - s['va'])
        return None

    def off2rva(self, off):
        for s in self.sections:
            if s['rawptr'] <= off < s['rawptr'] + s['rawsize']:
                return s['va'] + (off - s['rawptr'])
        return None

    def cstr(self, off):
        end = self.data.index(b'\0', off)
        return self.data[off:end].decode('latin1')

if __name__ == '__main__':
    pe = PE(sys.argv[1])
    print('imagebase 0x%X' % pe.imagebase)
    for s in pe.sections:
        print('  %-8s va=0x%X vsize=0x%X' % (s['name'], s['va'], s['vsize']))
    print('exports:', len(pe.exports))
