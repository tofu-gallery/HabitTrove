// Modified by Tofu on 2026-10-28: the GitHub button opens this copy's own
// source code (SOURCE_URL, AGPL-3.0 section 13) instead of upstream's
// repository (see TOFU.md).
'use client'

import { Dialog, DialogContent, DialogHeader } from "./ui/dialog"
import { Button } from "./ui/button"
import { Code, History } from "lucide-react"
import packageJson from '../package.json'
import { DialogTitle } from "@radix-ui/react-dialog"
import { useTranslations } from "next-intl"
import { Logo } from "./Logo"
import ChangelogModal from "./ChangelogModal"
import { useState } from "react"
import { useAtomValue } from "jotai"
import { serverSettingsAtom } from "@/lib/atoms"

interface AboutModalProps {
  onClose: () => void
}

export default function AboutModal({ onClose }: AboutModalProps) {
  const t = useTranslations('AboutModal')
  const tTofu = useTranslations('Tofu')
  const { sourceUrl } = useAtomValue(serverSettingsAtom)
  const version = packageJson.version
  const [changelogOpen, setChangelogOpen] = useState(false)

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle aria-label={t('dialogArisLabel')}></DialogTitle>
        </DialogHeader>
        <div className="space-y-6 text-center py-4">
          <div>
            <div className="flex justify-center mb-1">
              <Logo />
            </div>
            <div className="flex items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">v{version}</p>
            </div>
            <div className="py-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={() => setChangelogOpen(true)}
              >
                <History className="w-3 h-3 mr-1" />
                {t('changelogButton')}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-sm">
              {t('createdByPrefix')}{' '}
              <a
                href="https://github.com/dohsimpson"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                @dohsimpson
              </a>
            </div>

            <div className="flex justify-center">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-tofu="source-code"
              >
                <Button variant="outline" size="sm">
                  <Code className="w-4 h-4 mr-2" />
                  {tTofu('sourceCode')}
                </Button>
              </a>
            </div>
          </div>
        </div>
      </DialogContent>
      <ChangelogModal
        isOpen={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />
    </Dialog>
  )
}
